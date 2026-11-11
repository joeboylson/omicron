# A Linux machine with systemd running, to test `omicron daemon start-at-login`.
# Used by dev/docker/systemd-test.sh.
FROM ubuntu:24.04
RUN apt-get update -q && apt-get install -y -q --no-install-recommends systemd systemd-sysv dbus dbus-user-session ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && useradd -m pat
STOPSIGNAL SIGRTMIN+3
CMD ["/sbin/init"]
