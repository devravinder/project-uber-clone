// Prints every message a rider or driver socket receives from location-gateway.
const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, arg, i, all) => {
    if (arg.startsWith("--")) pairs.push([arg.slice(2), all[i + 1] ?? ""]);
    return pairs;
  }, []),
);
const user = args.user;
const role = args.role ?? "rider";
const gateway = args.gateway ?? process.env.GATEWAY_WS ?? "ws://localhost:7206";
if (!user) {
  console.error("Pass --user <id> [--role rider|driver] [--gateway ws://localhost:7216]");
  process.exitCode = 1;
} else {
  const ws = new WebSocket(`${gateway}/ws?user=${encodeURIComponent(user)}&role=${role}`);
  ws.addEventListener("open", () => console.log(`connected to ${gateway} as ${role} ${user}`));
  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    const time = new Date().toISOString().slice(11, 23);
    if (msg.type === "location")
      console.log(time, "location", msg.driverId, msg.lat.toFixed(5), msg.lng.toFixed(5));
    else if (msg.type === "trip")
      console.log(time, "trip", msg.trip.id, msg.trip.status, msg.trip.driverId ?? "");
    else console.log(time, JSON.stringify(msg));
  });
  ws.addEventListener("close", (event) => console.log(`closed ${event.code} ${event.reason}`));
}
