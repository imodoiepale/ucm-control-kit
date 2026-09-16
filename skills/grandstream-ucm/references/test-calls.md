# Test calls

`dialExtension(caller, callee)` makes the UCM ring `caller` first. When that phone is answered, the UCM dials `callee`. The kit polls `listBridgedChannels` every 2 s. A test **passes** when a bridged channel includes both extensions within the timeout (60 s by default).

The possible outcomes:

- `connected`: the call was bridged. Ask both people to confirm they can hear each other; a bridged call can still have one-way audio when NAT is wrong.
- `no-answer`: the phones rang, but nobody picked up.
- `failed`: an extension doesn't exist, has no registered phone, or the PBX never showed the call. Also check that the API user has the `dialExtension` permission.

## Recommended procedure after a repair

1. Check that `extension_status` shows the site as registered.
2. Pick a partner site that is known to work and has staff present.
3. Tell both sites a test call is coming.
4. Get the user's confirmation, then run `test_call from=<repaired> to=<partner> confirm=true`.
5. Record the outcome and the people who confirmed it.

## Overnight scorecard

Run test calls against an auto-answer target, such as an IVR or an echo-test extension, so nobody has to pick up. Keep the calls well apart to avoid load, and report the failures in the morning.
