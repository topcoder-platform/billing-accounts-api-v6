import { ApiOperationOptions } from "@nestjs/swagger";

interface OperationDocOptions
  extends Omit<ApiOperationOptions, "summary" | "description"> {
  summary: string;
  description?: string;
  jwtRoles?: string[];
  m2mScopes?: string[];
  publicAccess?: boolean;
}

const toCodeList = (values: string[]) =>
  values
    .filter((value) => value)
    .map((value) => `\`${value}\``)
    .join(", ");

export const buildOperationDoc = (
  options: OperationDocOptions,
): ApiOperationOptions => {
  const { summary, description, jwtRoles, m2mScopes, publicAccess, ...rest } =
    options;
  const sections: string[] = [];

  if (description?.trim()) {
    sections.push(description.trim());
  }

  if (publicAccess) {
    sections.push("**Authentication:** Not required.");
  } else {
    if (jwtRoles?.length) {
      sections.push(`**JWT roles:** ${toCodeList(jwtRoles)}`);
    }

    if (m2mScopes?.length) {
      sections.push(`**M2M scopes:** ${toCodeList(m2mScopes)}`);
    }

    if (!jwtRoles?.length && !m2mScopes?.length) {
      sections.push("**Authentication:** Requires a valid bearer token.");
    }
  }

  return {
    ...rest,
    summary,
    description: sections.length ? sections.join("\n\n") : undefined,
  };
};

export type { OperationDocOptions };
