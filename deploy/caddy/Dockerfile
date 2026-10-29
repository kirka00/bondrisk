FROM caddy:2.10-builder AS build
RUN xcaddy build --with github.com/mholt/caddy-ratelimit

FROM caddy:2.10
COPY --from=build /usr/bin/caddy /usr/bin/caddy
