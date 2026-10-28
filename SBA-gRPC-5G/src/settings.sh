mkdir -p /dev/net
mknod /dev/net/tun c 10 200 || true
chmod 666 /dev/net/tun
