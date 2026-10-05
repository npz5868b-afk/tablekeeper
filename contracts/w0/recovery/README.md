# Bounded C0 recovery harness

This directory proves contracts only. It does not contain Tablekeeper application services or migrations.
Image references are pinned by manifest-list digest in the Dockerfiles and runner; linux/amd64 platform digests
are recorded in `images.json`. Image/dependency assembly may use the network. Every proof container runs with
`--network none`, except PostgreSQL clients and server, which use an isolated Docker `--internal` network.

From Windows CMD at the repository root, run:

```cmd
contracts\w0\recovery\run-c0-recovery.cmd
```

The command preserves the accepted FAIL artifacts under `recovery\evidence\pre-recovery`, produces raw logs,
generated artifacts and a canonical evidence manifest, marks evidence files read-only, and independently verifies
all recorded hashes and PostgreSQL assertions. It does not change C0 status.
