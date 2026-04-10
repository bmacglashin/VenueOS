import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;

type SeedTenantArgs = {
  name: string;
  slug: string;
  ghlLocationId: string | null;
};

function printUsage(): void {
  console.log(`Usage:\n  npm run seed:tenant -- --name "Venue Name" --slug venue-slug [--ghl-location-id mock|real_id]\n\nExamples:\n  npm run seed:tenant -- --name "Veritas" --slug veritas --ghl-location-id mock\n  npm run seed:tenant -- --name "Veritas" --slug veritas --ghl-location-id loc_abc123`);
}

function parseArgs(argv: string[]): SeedTenantArgs {
  const args = new Map<string, string>();

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === "--help" || token === "-h") {
      printUsage();
      process.exit(0);
    }

    if (!token.startsWith("--")) {
      throw new Error(`Unexpected argument: ${token}`);
    }

    const key = token.slice(2);
    const value = argv[index + 1];

    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for --${key}`);
    }

    args.set(key, value);
    index += 1;
  }

  const name = args.get("name")?.trim();
  const rawSlug = args.get("slug")?.trim();
  const ghlLocationIdInput = args.get("ghl-location-id")?.trim();

  if (!name) {
    throw new Error("Missing required --name argument.");
  }

  if (!rawSlug) {
    throw new Error("Missing required --slug argument.");
  }

  const slug = rawSlug.toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new Error(
      "Slug must be lowercase kebab-case (letters, numbers, and hyphens only).",
    );
  }

  return {
    name,
    slug,
    ghlLocationId:
      !ghlLocationIdInput || ghlLocationIdInput.toLowerCase() === "mock"
        ? null
        : ghlLocationIdInput,
  };
}

async function main(): Promise<void> {
  loadEnvConfig(process.cwd());

  const parsed = parseArgs(process.argv.slice(2));

  const { createSupabaseAdminClient } = await import("../src/lib/db/admin");

  const supabase = createSupabaseAdminClient();

  const existingBySlug = await supabase
    .from("venue_tenants")
    .select("id, name, slug")
    .eq("slug", parsed.slug)
    .maybeSingle();

  if (existingBySlug.error) {
    throw new Error(`Unable to check existing tenant slug: ${existingBySlug.error.message}`);
  }

  if (existingBySlug.data) {
    console.log(
      `No insert performed. Tenant slug "${parsed.slug}" already exists (id=${existingBySlug.data.id}, name=${existingBySlug.data.name}).`,
    );
    return;
  }

  const inserted = await supabase
    .from("venue_tenants")
    .insert({
      name: parsed.name,
      slug: parsed.slug,
      ghl_location_id: parsed.ghlLocationId,
    })
    .select("id, name, slug, ghl_location_id")
    .single();

  if (inserted.error) {
    throw new Error(`Failed to seed tenant: ${inserted.error.message}`);
  }

  console.log(
    `Seeded tenant successfully: id=${inserted.data.id}, name=${inserted.data.name}, slug=${inserted.data.slug}, ghl_location_id=${inserted.data.ghl_location_id ?? "<null/mock>"}`,
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  console.error(`Tenant seed failed: ${message}`);
  printUsage();
  process.exit(1);
});
