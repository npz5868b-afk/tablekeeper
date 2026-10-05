# Tablekeeper local Operator

Double-click `TABLEKEEPER.cmd` in the repository root. On the first run, choose **First-time setup** and enter the existing local PostgreSQL bootstrap and `core_runtime` URLs. Input is hidden and stored only under `operator/secrets/`, which is excluded from source control. Runtime tokens and the confirmation secret are generated automatically.

Normal **Start** never migrates, seeds, or deletes data. **Reset Demo** is the only destructive action: it verifies that both configured URLs name exactly `tablekeeper`, refuses protected and integration databases, requires typing `RESET`, then recreates the database through the authoritative migrations and canonical seed descriptor.

Launcher state and logs are under `operator/state/`. Stop validates each recorded process start time and terminates only launcher-owned process trees. PostgreSQL itself is never stopped.
