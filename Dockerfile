FROM node:22-bookworm AS web-build
RUN corepack enable
WORKDIR /app

COPY package.json pnpm-workspace.yaml .npmrc ./
COPY backend/package.json ./backend/package.json
COPY frontend/package.json ./frontend/package.json
RUN pnpm install --frozen-lockfile=false

COPY scripts ./scripts
COPY .env.example ./.env.example
COPY backend ./backend
COPY frontend ./frontend
RUN pnpm --filter @lichtfeld/frontend build && pnpm --filter @lichtfeld/backend build

FROM nvidia/cuda:12.8.0-devel-ubuntu24.04 AS lfs-build
ARG LFS_REPO=https://github.com/MrNeRF/LichtFeld-Studio.git
ARG LFS_REF=master

ENV DEBIAN_FRONTEND=noninteractive
RUN set -eux; \
    for attempt in 1 2 3 4 5; do \
      rm -rf /var/lib/apt/lists/*; \
      if apt-get update -o Acquire::Retries=5 -o Acquire::By-Hash=yes \
        && apt-get install -y --no-install-recommends \
          autoconf \
          autoconf-archive \
          automake \
          build-essential \
          ca-certificates \
          curl \
          git \
          libgl1-mesa-dev \
          libglu1-mesa-dev \
          libopengl-dev \
          libglx-dev \
          libxcursor-dev \
          libxinerama-dev \
          libtool \
          nasm \
          ninja-build \
          pkg-config \
          python3 \
          python3-dev \
          python3-pip \
          unzip \
          xorg-dev \
          zip \
          wget \
          gcc-14 \
          g++-14 \
          gfortran-14; then \
        break; \
      fi; \
      if [ "$attempt" -eq 5 ]; then \
        echo "apt install failed after ${attempt} attempts"; \
        exit 1; \
      fi; \
      echo "apt install failed on attempt ${attempt}, retrying..."; \
      sleep $((attempt * 5)); \
    done; \
    rm -rf /var/lib/apt/lists/*

RUN update-alternatives --install /usr/bin/gcc gcc /usr/bin/gcc-14 60 \
    && update-alternatives --install /usr/bin/g++ g++ /usr/bin/g++-14 60 \
    && update-alternatives --install /usr/bin/gfortran gfortran /usr/bin/gfortran-14 60

RUN wget -q https://github.com/Kitware/CMake/releases/download/v4.0.3/cmake-4.0.3-linux-x86_64.sh \
    && chmod +x cmake-4.0.3-linux-x86_64.sh \
    && ./cmake-4.0.3-linux-x86_64.sh --skip-license --prefix=/usr/local \
    && rm -f cmake-4.0.3-linux-x86_64.sh

RUN git clone https://github.com/microsoft/vcpkg.git /opt/vcpkg \
    && /opt/vcpkg/bootstrap-vcpkg.sh -disableMetrics

WORKDIR /opt/src
RUN git clone ${LFS_REPO} LichtFeld-Studio \
    && cd LichtFeld-Studio \
    && if [ -n "${LFS_REF}" ]; then git checkout "${LFS_REF}" || echo "LFS_REF not found, using default branch"; fi \
    && git submodule update --init --recursive

WORKDIR /opt/src/LichtFeld-Studio
RUN cmake -B build \
    -DCMAKE_BUILD_TYPE=Release \
    -DBUILD_PYTHON_STUBS=OFF \
    -G Ninja \
    -DCMAKE_TOOLCHAIN_FILE=/opt/vcpkg/scripts/buildsystems/vcpkg.cmake \
    && cmake --build build -- -j"$(nproc)" \
    && cmake --install build --prefix /opt/lichtfeld \
    && mkdir -p /opt/lichtfeld/lib /opt/lichtfeld/bin \
    && find /opt/src/LichtFeld-Studio/build -type f -name 'liblfs_*.so*' -exec cp -an {} /opt/lichtfeld/lib/ \; \
    && find /opt/lichtfeld -type f -name 'liblfs_*.so*' -exec cp -an {} /opt/lichtfeld/lib/ \; \
    && for lib in /opt/lichtfeld/lib/liblfs_*.so.*; do \
         [ -e "$lib" ] || continue; \
         soname="${lib%%.so.*}.so"; \
         [ -e "$soname" ] || ln -s "$(basename "$lib")" "$soname"; \
       done

FROM nvidia/cuda:12.8.0-runtime-ubuntu24.04
ENV DEBIAN_FRONTEND=noninteractive
RUN set -eux; \
    for attempt in 1 2 3 4 5; do \
      rm -rf /var/lib/apt/lists/*; \
      if apt-get update -o Acquire::Retries=5 -o Acquire::By-Hash=yes \
        && apt-get install -y --no-install-recommends \
          ca-certificates \
          curl \
          libasound2t64 \
          libdbus-1-3 \
          libdrm2 \
          libegl1 \
          libgbm1 \
          libgl1 \
          libglu1-mesa \
          libglvnd0 \
          libice6 \
          libnss3 \
          libopengl0 \
          libsm6 \
          libx11-6 \
          libxcursor1 \
          libxdamage1 \
          libxext6 \
          libxfixes3 \
          libxi6 \
          libxinerama1 \
          libxkbcommon0 \
          libxrandr2 \
          libxrender1 \
          libxtst6 \
          libxxf86vm1 \
          libglx0 \
          unzip \
          zip; then \
        break; \
      fi; \
      if [ "$attempt" -eq 5 ]; then \
        echo "runtime apt install failed after ${attempt} attempts"; \
        exit 1; \
      fi; \
      echo "runtime apt install failed on attempt ${attempt}, retrying..."; \
      sleep $((attempt * 5)); \
    done; \
    rm -rf /var/lib/apt/lists/*

RUN set -eux; \
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -; \
    for attempt in 1 2 3 4 5; do \
      rm -rf /var/lib/apt/lists/*; \
      if apt-get update -o Acquire::Retries=5 -o Acquire::By-Hash=yes \
        && apt-get install -y --no-install-recommends nodejs; then \
        break; \
      fi; \
      if [ "$attempt" -eq 5 ]; then \
        echo "nodejs apt install failed after ${attempt} attempts"; \
        exit 1; \
      fi; \
      echo "nodejs apt install failed on attempt ${attempt}, retrying..."; \
      sleep $((attempt * 5)); \
    done; \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=lfs-build /opt/lichtfeld /opt/lichtfeld
COPY --from=web-build /app /app

ENV LFS_BIN_PATH=/opt/lichtfeld/bin/LichtFeld-Studio
ENV LD_LIBRARY_PATH=/opt/lichtfeld/lib:/opt/lichtfeld/lib64:/opt/lichtfeld/bin

RUN printf "/opt/lichtfeld/lib\n/opt/lichtfeld/lib64\n/opt/lichtfeld/bin\n" > /etc/ld.so.conf.d/lichtfeld.conf && ldconfig

EXPOSE 3000
CMD ["node", "scripts/docker-entrypoint.mjs"]
