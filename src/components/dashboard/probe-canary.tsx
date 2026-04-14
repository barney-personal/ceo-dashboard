const DEFAULT_CANARY = "ceo-dashboard-canary-ok";

export function ProbeCanary() {
  const value = process.env.CANARY_EXPECTED_VALUE || DEFAULT_CANARY;

  return (
    <span
      data-testid="probe-canary"
      aria-hidden="true"
      className="sr-only"
    >
      {value}
    </span>
  );
}
