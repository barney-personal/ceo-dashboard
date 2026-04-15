/**
 * Migrate users from Clerk dev instance to production instance.
 *
 * Exports all users from the source (dev) Clerk instance and creates
 * them in the target (prod) instance, preserving publicMetadata (roles).
 *
 * Usage:
 *   CLERK_SOURCE_SECRET_KEY=sk_test_... \
 *   CLERK_TARGET_SECRET_KEY=sk_live_... \
 *   npx tsx scripts/migrate-clerk-users.ts
 *
 * Dry-run (default): prints what would be created without making changes.
 * Pass --execute to actually create users in the target instance.
 */

const SOURCE_KEY = process.env.CLERK_SOURCE_SECRET_KEY;
const TARGET_KEY = process.env.CLERK_TARGET_SECRET_KEY;

if (!SOURCE_KEY || !TARGET_KEY) {
  console.error(
    "Missing env vars. Set CLERK_SOURCE_SECRET_KEY and CLERK_TARGET_SECRET_KEY."
  );
  process.exit(1);
}

const dryRun = !process.argv.includes("--execute");

if (dryRun) {
  console.log("🔍 DRY RUN — pass --execute to create users in target instance\n");
}

interface ClerkUser {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email_addresses: { email_address: string; id: string }[];
  primary_email_address_id: string | null;
  public_metadata: Record<string, unknown>;
  private_metadata: Record<string, unknown>;
  unsafe_metadata: Record<string, unknown>;
  created_at: number;
}

async function clerkFetch(
  secretKey: string,
  path: string,
  options?: RequestInit
): Promise<Response> {
  const res = await fetch(`https://api.clerk.com/v1${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/json",
      ...(options?.headers ?? {}),
    },
  });
  return res;
}

async function fetchAllUsers(secretKey: string): Promise<ClerkUser[]> {
  const users: ClerkUser[] = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const res = await clerkFetch(
      secretKey,
      `/users?limit=${limit}&offset=${offset}&order_by=-created_at`
    );

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Failed to fetch users (offset=${offset}): ${res.status} ${body}`);
    }

    const batch: ClerkUser[] = await res.json();
    if (batch.length === 0) break;

    users.push(...batch);
    offset += limit;

    if (batch.length < limit) break;
  }

  return users;
}

async function findExistingUserByEmail(
  secretKey: string,
  email: string
): Promise<ClerkUser | null> {
  const res = await clerkFetch(
    secretKey,
    `/users?email_address=${encodeURIComponent(email)}&limit=1`
  );

  if (!res.ok) return null;

  const users: ClerkUser[] = await res.json();
  return users.length > 0 ? users[0] : null;
}

async function createUser(
  secretKey: string,
  sourceUser: ClerkUser
): Promise<{ id: string } | null> {
  const primaryEmail = sourceUser.email_addresses.find(
    (e) => e.id === sourceUser.primary_email_address_id
  );
  const email = primaryEmail?.email_address ?? sourceUser.email_addresses[0]?.email_address;

  if (!email) {
    console.warn(`  ⚠ Skipping user ${sourceUser.id} — no email address`);
    return null;
  }

  // Check if user already exists in target
  const existing = await findExistingUserByEmail(secretKey, email);
  if (existing) {
    console.log(`  ⏭ ${email} already exists in target (${existing.id}), updating metadata...`);
    // Update their metadata to match source
    const updateRes = await clerkFetch(secretKey, `/users/${existing.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        public_metadata: sourceUser.public_metadata,
      }),
    });
    if (!updateRes.ok) {
      const body = await updateRes.text();
      console.warn(`  ⚠ Failed to update metadata for ${email}: ${body}`);
    }
    return { id: existing.id };
  }

  const res = await clerkFetch(secretKey, "/users", {
    method: "POST",
    body: JSON.stringify({
      email_address: [email],
      first_name: sourceUser.first_name,
      last_name: sourceUser.last_name,
      public_metadata: sourceUser.public_metadata,
      private_metadata: sourceUser.private_metadata,
      unsafe_metadata: sourceUser.unsafe_metadata,
      // Don't set a password — users will sign in via Google SSO
      skip_password_requirement: true,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    console.warn(`  ⚠ Failed to create ${email}: ${res.status} ${body}`);
    return null;
  }

  const created = await res.json();
  return { id: created.id };
}

async function main() {
  console.log("Fetching users from source (dev) instance...");
  const sourceUsers = await fetchAllUsers(SOURCE_KEY!);
  console.log(`Found ${sourceUsers.length} users in source instance.\n`);

  for (const user of sourceUsers) {
    const email =
      user.email_addresses.find((e) => e.id === user.primary_email_address_id)
        ?.email_address ?? user.email_addresses[0]?.email_address;

    const role = (user.public_metadata as { role?: string }).role ?? "everyone";
    const name = [user.first_name, user.last_name].filter(Boolean).join(" ") || "(no name)";

    if (dryRun) {
      console.log(`  Would migrate: ${email} (${name}) — role: ${role}`);
    } else {
      process.stdout.write(`  Migrating ${email} (${name}, role: ${role})...`);
      const result = await createUser(TARGET_KEY!, user);
      if (result) {
        console.log(` ✓ ${result.id}`);
      } else {
        console.log(` ✗ failed`);
      }
    }
  }

  console.log("\nDone.");
  if (dryRun) {
    console.log("This was a dry run. Pass --execute to create users in the target instance.");
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
