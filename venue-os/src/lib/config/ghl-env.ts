import { z } from "zod";

import { ConfigError } from "@/src/lib/observability";

export const GHL_EXECUTION_MODES = ["disabled", "dry_run", "live"] as const;

export type GhlExecutionMode = (typeof GHL_EXECUTION_MODES)[number];

export interface GhlLiveEnv {
  GHL_API_KEY: string;
  GHL_LOCATION_ID: string;
  GHL_BASE_URL: string;
}

export interface GhlEnvChecklistStatus {
  missingRequired: string[];
  invalidRequired: string[];
}

const ghlLiveEnvSchema = z
  .object({
    GHL_API_KEY: z.string().trim().min(1),
    GHL_LOCATION_ID: z.string().trim().min(1),
    GHL_BASE_URL: z.string().trim().url(),
  })
  .strict();

const TRUE_VALUES = new Set(["1", "true", "yes", "on", "enabled"]);
const FALSE_VALUES = new Set(["0", "false", "no", "off", "disabled"]);

function readTrimmedEnvValue(
  name: string,
  envSource: NodeJS.ProcessEnv = process.env
): string | null {
  const value = envSource[name]?.trim();
  return value != null && value.length > 0 ? value : null;
}

function formatGhlEnvProblemMessage(
  context: string,
  checklist: GhlEnvChecklistStatus
): string {
  const details: string[] = [];

  if (checklist.missingRequired.length > 0) {
    details.push(`missing: ${checklist.missingRequired.join(", ")}`);
  }

  if (checklist.invalidRequired.length > 0) {
    details.push(`invalid: ${checklist.invalidRequired.join(", ")}`);
  }

  return `${context}${details.length > 0 ? ` (${details.join("; ")})` : ""}.`;
}

export function parseGhlExecutionMode(
  rawValue: string | null | undefined
): GhlExecutionMode | null {
  if (rawValue == null) {
    return null;
  }

  return GHL_EXECUTION_MODES.find((mode) => mode === rawValue.trim()) ?? null;
}

export function parseGhlWriteKillSwitch(
  rawValue: string | null | undefined
): boolean | null {
  if (rawValue == null) {
    return null;
  }

  const normalized = rawValue.trim().toLowerCase();

  if (TRUE_VALUES.has(normalized)) {
    return true;
  }

  if (FALSE_VALUES.has(normalized)) {
    return false;
  }

  return null;
}

export function getGhlEnvChecklistStatus(
  envSource: NodeJS.ProcessEnv = process.env
): GhlEnvChecklistStatus {
  const missingRequired: string[] = [];
  const invalidRequired: string[] = [];

  const executionMode = readTrimmedEnvValue("GHL_EXECUTION_MODE", envSource);
  const killSwitch = readTrimmedEnvValue("GHL_WRITE_KILL_SWITCH", envSource);
  const apiKey = readTrimmedEnvValue("GHL_API_KEY", envSource);
  const locationId = readTrimmedEnvValue("GHL_LOCATION_ID", envSource);
  const baseUrl = readTrimmedEnvValue("GHL_BASE_URL", envSource);

  if (executionMode == null) {
    missingRequired.push("GHL_EXECUTION_MODE");
  } else if (parseGhlExecutionMode(executionMode) == null) {
    invalidRequired.push("GHL_EXECUTION_MODE");
  }

  if (killSwitch == null) {
    missingRequired.push("GHL_WRITE_KILL_SWITCH");
  } else if (parseGhlWriteKillSwitch(killSwitch) == null) {
    invalidRequired.push("GHL_WRITE_KILL_SWITCH");
  }

  if (apiKey == null) {
    missingRequired.push("GHL_API_KEY");
  }

  if (locationId == null) {
    missingRequired.push("GHL_LOCATION_ID");
  }

  if (baseUrl == null) {
    missingRequired.push("GHL_BASE_URL");
  } else {
    const baseUrlResult = z.string().trim().url().safeParse(baseUrl);

    if (!baseUrlResult.success) {
      invalidRequired.push("GHL_BASE_URL");
    }
  }

  return {
    missingRequired,
    invalidRequired,
  };
}

export function getValidatedGhlExecutionControls(
  envSource: NodeJS.ProcessEnv = process.env
): {
  mode: GhlExecutionMode;
  killSwitchEnabled: boolean;
} {
  const checklist = getGhlEnvChecklistStatus(envSource);
  const controlChecklist: GhlEnvChecklistStatus = {
    missingRequired: checklist.missingRequired.filter(
      (name) => name === "GHL_EXECUTION_MODE" || name === "GHL_WRITE_KILL_SWITCH"
    ),
    invalidRequired: checklist.invalidRequired.filter(
      (name) => name === "GHL_EXECUTION_MODE" || name === "GHL_WRITE_KILL_SWITCH"
    ),
  };

  if (
    controlChecklist.missingRequired.length > 0 ||
    controlChecklist.invalidRequired.length > 0
  ) {
    throw new ConfigError(
      formatGhlEnvProblemMessage(
        "GHL execution controls are not configured correctly",
        controlChecklist
      )
    );
  }

  const mode = parseGhlExecutionMode(
    readTrimmedEnvValue("GHL_EXECUTION_MODE", envSource)
  );
  const killSwitchEnabled = parseGhlWriteKillSwitch(
    readTrimmedEnvValue("GHL_WRITE_KILL_SWITCH", envSource)
  );

  if (mode == null || killSwitchEnabled == null) {
    throw new ConfigError(
      "GHL execution controls are not configured correctly (missing: GHL_EXECUTION_MODE, GHL_WRITE_KILL_SWITCH)."
    );
  }

  return {
    mode,
    killSwitchEnabled,
  };
}

export function getValidatedGhlLiveEnv(
  envSource: NodeJS.ProcessEnv = process.env
): GhlLiveEnv {
  const rawEnv = {
    GHL_API_KEY: readTrimmedEnvValue("GHL_API_KEY", envSource),
    GHL_LOCATION_ID: readTrimmedEnvValue("GHL_LOCATION_ID", envSource),
    GHL_BASE_URL: readTrimmedEnvValue("GHL_BASE_URL", envSource),
  };

  const result = ghlLiveEnvSchema.safeParse(rawEnv);

  if (result.success) {
    return result.data;
  }

  const checklist = getGhlEnvChecklistStatus(envSource);

  throw new ConfigError(
    formatGhlEnvProblemMessage(
      "Live GHL writes require valid environment variables",
      {
        missingRequired: checklist.missingRequired.filter((name) =>
          ["GHL_API_KEY", "GHL_LOCATION_ID", "GHL_BASE_URL"].includes(name)
        ),
        invalidRequired: checklist.invalidRequired.filter((name) =>
          ["GHL_API_KEY", "GHL_LOCATION_ID", "GHL_BASE_URL"].includes(name)
        ),
      }
    ),
    {
      cause: result.error,
    }
  );
}
