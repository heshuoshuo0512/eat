# Local k6 baseline

Run these tests only against the isolated release-candidate stack. Output is
written to `.performance-results/` and is not committed.

```powershell
npm run perf:k6 -- --scenario=catalog --vus=100 --duration=5m
npm run perf:k6 -- --scenario=catalog --vus=300 --duration=10m
npm run perf:k6 -- --scenario=catalog --vus=500 --duration=15m
npm run perf:k6 -- --scenario=catalog --vus=500 --duration=30m
```

The session scenario requires `IDENTIFIER` and `PASSWORD`. Community writes
require `ACCESS_TOKEN`, `TARGET_TYPE` and `TARGET_ID`, and must use a disposable
test tenant. The Agent scenario is measured separately because model latency
must not be mixed with ordinary API latency.
