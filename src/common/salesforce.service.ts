import { Injectable } from "@nestjs/common";
import * as jwt from "jsonwebtoken";
import axios from "axios";
import { get } from "lodash";

const loginBaseUrl =
  process.env.SALESFORCE_AUDIENCE || "https://login.salesforce.com";
let privateKey = process.env.SALESFORCE_CLIENT_KEY || "privateKey";
privateKey = privateKey.replace(/\\n/g, "\n");

const urlEncodeForm = (k: Record<string, any>) =>
  Object.keys(k).reduce((a, b) => `${a}&${b}=${encodeURIComponent(k[b])}`, "");

@Injectable()
export class SalesforceService {
  private parseIntStrictly(v: any, radix = 10, fallback: any = null) {
    const n = parseInt(String(v), radix);
    return Number.isNaN(n) ? fallback : n;
  }

  async authenticate(): Promise<{ accessToken: string; instanceUrl: string }> {
    const jwtToken = jwt.sign({}, privateKey, {
      expiresIn: "1h",
      issuer: process.env.SALESFORCE_CLIENT_ID,
      audience: process.env.SALESFORCE_AUDIENCE,
      subject: process.env.SALESFORCE_SUBJECT,
      algorithm: "RS256",
    });
    const res = await axios({
      method: "post",
      url: `${loginBaseUrl}/services/oauth2/token`,
      data: urlEncodeForm({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: jwtToken,
      }),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    return {
      accessToken: res.data.access_token,
      instanceUrl: res.data.instance_url,
    };
  }

  async queryUserBillingAccounts(
    sql: string,
    accessToken: string,
    instanceUrl: string,
    logger?: any,
  ) {
    const res = await axios({
      url: `${instanceUrl}/services/data/v37.0/query?q=${sql}`,
      method: "get",
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (logger) logger.debug(get(res, "data.records", []));
    const billingAccounts = get(res, "data.records", []).map((o: any) => ({
      sfBillingAccountId: get(o, "Topcoder_Billing_Account__r.Id"),
      tcBillingAccountId: this.parseIntStrictly(
        get(o, "Topcoder_Billing_Account__r.TopCoder_Billing_Account_Id__c"),
        10,
        null,
      ),
      name: get(
        o,
        `Topcoder_Billing_Account__r.${process.env.SFDC_BILLING_ACCOUNT_NAME_FIELD || "Billing_Account_name__c"}`,
      ),
      startDate: get(o, "Topcoder_Billing_Account__r.Start_Date__c"),
      endDate: get(o, "Topcoder_Billing_Account__r.End_Date__c"),
    }));
    return billingAccounts;
  }

  async queryBillingAccount(
    sql: string,
    accessToken: string,
    instanceUrl: string,
    logger?: any,
  ) {
    const res = await axios({
      url: `${instanceUrl}/services/data/v37.0/query?q=${sql}`,
      method: "get",
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (logger) logger.debug(get(res, "data.records", []));
    const billingAccounts = get(res, "data.records", []).map((o: any) => ({
      tcBillingAccountId: this.parseIntStrictly(
        get(o, "TopCoder_Billing_Account_Id__c"),
        10,
        null,
      ),
      markup: get(
        o,
        process.env.SFDC_BILLING_ACCOUNT_MARKUP_FIELD || "Mark_Up__c",
      ),
      active: get(
        o,
        process.env.SFDC_BILLING_ACCOUNT_ACTIVE_FIELD || "Active__c",
      ),
      startDate: get(o, "Start_Date__c"),
      endDate: get(o, "End_Date__c"),
    }));
    return billingAccounts.length > 0 ? billingAccounts[0] : {};
  }
}

export default SalesforceService;
