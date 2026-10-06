import {
  BadGatewayException,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { setTimeout as delay } from "node:timers/promises";

export type SalesforceRecord = Record<string, string | null> & { Id: string };
interface Session {
  access_token: string;
  instance_url: string;
}

/** Read-only SOQL client using the same client-credentials flow as the Sales report. */
@Injectable()
export class SalesforceSyncClient {
  constructor(private readonly config: ConfigService) {}

  /**
   * Validates an OAuth origin before credentials or bearer tokens are sent.
   * @param value Configured login or OAuth instance URL.
   * @returns Trusted HTTPS Salesforce origin.
   * @throws ServiceUnavailableException for invalid configuration.
   */
  private origin(value: string): string {
    try {
      const url = new URL(value);
      if (
        url.protocol === "https:" &&
        !url.username &&
        !url.password &&
        !url.port &&
        url.pathname === "/" &&
        !url.search &&
        !url.hash &&
        (url.hostname.endsWith(".my.salesforce.com") ||
          ["login.salesforce.com", "test.salesforce.com"].includes(
            url.hostname,
          ))
      )
        return url.origin;
    } catch {
      /* Use a sanitized configuration error below. */
    }
    throw new ServiceUnavailableException("Salesforce sync is not configured.");
  }

  /**
   * Executes a bounded request, retrying transient read/OAuth failures at most twice.
   * @param url Trusted Salesforce URL.
   * @param init Request options; credentials and upstream bodies are never logged.
   * @returns Non-transient response.
   * @throws BadGatewayException after timeout, network failure, throttling or 5xx retries.
   */
  private async request(url: string, init: RequestInit): Promise<Response> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await fetch(url, {
          ...init,
          redirect: "error",
          signal: AbortSignal.timeout(15000),
        });
        if (response.status !== 429 && response.status < 500) return response;
        await response.body?.cancel();
      } catch {
        /* Never expose fetch errors containing credentials. */
      }
      if (attempt < 2) await delay(250 * 2 ** attempt);
    }
    throw new BadGatewayException(
      "Salesforce is temporarily unavailable. Please try again.",
    );
  }

  /**
   * Authenticates lazily; the session is held only for the current sync's queries.
   * @returns An in-memory access token and trusted instance URL.
   * @throws ServiceUnavailableException for missing configuration; BadGatewayException for OAuth failure.
   */
  async authenticate(): Promise<Session> {
    const clientId = this.config.get<string>("SALESFORCE_API_CONSUMER_KEY");
    const clientSecret = this.config.get<string>(
      "SALESFORCE_API_CONSUMER_SECRET",
    );
    const origin = this.origin(
      this.config.get<string>(
        "SALESFORCE_LOGIN_URL",
        "https://topcoder.my.salesforce.com",
      ),
    );
    if (!clientId || !clientSecret) {
      throw new ServiceUnavailableException(
        "Salesforce sync is not configured.",
      );
    }
    const response = await this.request(`${origin}/services/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });
    if (!response.ok)
      throw new BadGatewayException("Salesforce authentication failed.");
    const session = (await response.json().catch(() => null)) as Session | null;
    if (
      !session ||
      typeof session.access_token !== "string" ||
      !session.access_token ||
      typeof session.instance_url !== "string"
    ) {
      throw new BadGatewayException(
        "Salesforce returned an invalid authentication response.",
      );
    }
    return { ...session, instance_url: this.origin(session.instance_url) };
  }

  /**
   * Retrieves every page, including inactive records, for a fixed metadata query.
   * @param object Salesforce object API name supplied by the sync service, never user input.
   * @param fields String-valued fields required for matching and metadata updates.
   * @param session Shared OAuth session; renewed once on expiration.
   * @returns Complete validated records, preserving explicit nulls.
   * @throws BadGatewayException on query, pagination or response errors; never returns a partial snapshot.
   */
  async queryAll(
    object: string,
    fields: string[],
    session: Session,
  ): Promise<SalesforceRecord[]> {
    const version = this.config.get<string>("SALESFORCE_API_VERSION", "v65.0");
    if (!/^v\d+\.0$/.test(version)) {
      throw new ServiceUnavailableException("Invalid Salesforce API version.");
    }
    const prefix = `/services/data/${version}/query`;
    let path = `${prefix}?${new URLSearchParams({ q: `SELECT ${fields.join(",")} FROM ${object}` })}`;
    const visited = new Set<string>();
    const records: SalesforceRecord[] = [];
    while (path) {
      if (visited.has(path))
        throw new BadGatewayException("Invalid Salesforce pagination.");
      visited.add(path);
      let response = await this.request(`${session.instance_url}${path}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (response.status === 401) {
        await response.body?.cancel();
        Object.assign(session, await this.authenticate());
        response = await this.request(`${session.instance_url}${path}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
      }
      if (!response.ok)
        throw new BadGatewayException("Salesforce metadata query failed.");
      const page = (await response.json().catch(() => null)) as {
        records?: SalesforceRecord[];
        done?: boolean;
        nextRecordsUrl?: string;
      } | null;
      if (
        !page ||
        !Array.isArray(page.records) ||
        typeof page.done !== "boolean" ||
        page.records.some(
          (row) =>
            !row ||
            typeof row.Id !== "string" ||
            !/^[a-zA-Z0-9]{18}$/.test(row.Id) ||
            fields.some(
              (field) => row[field] !== null && typeof row[field] !== "string",
            ),
        )
      ) {
        throw new BadGatewayException(
          "Salesforce returned incomplete metadata.",
        );
      }
      records.push(...page.records);
      if (page.done) break;
      if (
        typeof page.nextRecordsUrl !== "string" ||
        !page.nextRecordsUrl.startsWith(`${prefix}/`) ||
        !/^\/services\/data\/v\d+\.0\/query\/[a-zA-Z0-9-]+$/.test(
          page.nextRecordsUrl,
        )
      ) {
        throw new BadGatewayException("Invalid Salesforce pagination.");
      }
      path = page.nextRecordsUrl;
    }
    return records;
  }
}
