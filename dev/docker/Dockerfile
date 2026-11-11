# The omicron-dev test machine as a Docker container, for when multipass isn't
# installed. Same user, home folder and paths as the multipass VM, so every
# script in dev/ runs unchanged. Built and started by dev/docker/setup.sh.
FROM ubuntu:24.04

RUN apt-get update -q && apt-get install -y -q --no-install-recommends \
      build-essential pkg-config libssl-dev curl git ca-certificates sudo jq openssl \
      gnupg python3 \
 && install -m 0755 -d /etc/apt/keyrings \
 && curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc \
 && echo "deb [signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu noble stable" > /etc/apt/sources.list.d/docker.list \
 && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
 && apt-get install -y -q --no-install-recommends docker-ce-cli docker-compose-plugin nodejs \
 && rm -rf /var/lib/apt/lists/* \
 && echo 'ubuntu ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/ubuntu

USER ubuntu
WORKDIR /home/ubuntu
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal \
 && echo 'export CARGO_TARGET_DIR=$HOME/target' >> /home/ubuntu/.bashrc
CMD ["sleep", "infinity"]
