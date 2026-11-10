# Identity test: Tailscale sign-in through a test VM

Question: can a page running in a multipass VM learn who is connecting, using
this Mac's Tailscale login, without the VM joining Tailscale itself?

## Setup

1. VM: `multipass launch 24.04 --name omicron-dev`, with this folder mounted at
   `/home/ubuntu/omicron`.
2. In the VM: `python3 /home/ubuntu/omicron/dev/identity-test/echo.py`. It
   listens on port 8080 and shows any `Tailscale-*` headers it gets.
3. On the Mac: a small relay from `127.0.0.1:18460` to the VM's port 8080, then
   `tailscale serve --bg --http=8460 http://127.0.0.1:18460`.
   (Pointing `tailscale serve` straight at the VM's IP also works.)

## Results (10 Nov 2026)

- **The path works.** From another device on the tailnet,
  `curl http://<mac>.<tailnet>.ts.net:8460/` reached the page in the VM,
  through the Mac's Tailscale.
- **No identity from that device, as expected.** It was a tagged server with
  no person attached, so Tailscale adds no identity headers for it.
- **People do have an identity.** `tailscale whois <this Mac's Tailscale IP>`
  returns the person's login (like `someone@github`). That's the lookup the Web Machine
  depends on.
- **This Mac can't open its own Tailscale address.** Both the test port and the
  existing port 8274 time out from here. So the last check has to come from
  another device signed in as a person (a phone or laptop).
- This Mac is on the **work** tailnet. The real target (homelab, family) is the
  **personal** tailnet, which also needs testing.
- The test forward was turned off afterwards (`tailscale serve --http=8460 off`).

## Still to check

1. Open the page from a device signed in as a person, and confirm the
   `Tailscale-User-Login` header shows up.
2. Repeat on the personal tailnet.

## What this means for Omicron

- A Web Machine doesn't need its own Tailscale login or Go's `tsnet`. The
  Tailscale already running on the machine passes the person's identity along.
- The page must only accept requests that come through `tailscale serve`
  (listen on localhost only). Otherwise anyone could fake the headers.
- Tagged servers never get a person's identity. They sign in with
  their machine API key instead, which matches the plan.
