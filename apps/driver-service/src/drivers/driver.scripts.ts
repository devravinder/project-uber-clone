// Per driver one state hash; drv:geo holds online drivers, drv:geo:available the offerable ones.

// KEYS: state, alive, geoAll, geoAvailable. ARGV: id, lng, lat, now, ttlSeconds.
export const GO_ONLINE = `
local status = redis.call('HGET', KEYS[1], 'status')
if status ~= 'offered' and status ~= 'on_trip' then
  status = 'available'
  redis.call('HSET', KEYS[1], 'status', status, 'tripId', '', 'offerUntil', '')
end
redis.call('HSET', KEYS[1], 'lat', ARGV[3], 'lng', ARGV[2], 'at', ARGV[4])
redis.call('GEOADD', KEYS[3], ARGV[2], ARGV[3], ARGV[1])
if status == 'available' then redis.call('GEOADD', KEYS[4], ARGV[2], ARGV[3], ARGV[1]) end
redis.call('SET', KEYS[2], '1', 'EX', ARGV[5])
return status`;

// As GO_ONLINE plus ARGV[6] = channel; publishing here saves a round trip.
export const UPDATE_LOCATION = `
local status = redis.call('HGET', KEYS[1], 'status')
if not status or status == 'offline' then return 'offline' end
redis.call('HSET', KEYS[1], 'lat', ARGV[3], 'lng', ARGV[2], 'at', ARGV[4])
redis.call('GEOADD', KEYS[3], ARGV[2], ARGV[3], ARGV[1])
if status == 'available' then redis.call('GEOADD', KEYS[4], ARGV[2], ARGV[3], ARGV[1]) end
redis.call('SET', KEYS[2], '1', 'EX', ARGV[5])
redis.call('PUBLISH', ARGV[6], '{"type":"location","driverId":"' .. ARGV[1] .. '","lat":' .. ARGV[3] .. ',"lng":' .. ARGV[2] .. ',"at":' .. ARGV[4] .. '}')
return status`;

// KEYS: state, alive, geoAll, geoAvailable. ARGV: id. Returns the status after the call.
export const GO_OFFLINE = `
local status = redis.call('HGET', KEYS[1], 'status')
if status == 'offered' or status == 'on_trip' then return status end
redis.call('HSET', KEYS[1], 'status', 'offline', 'tripId', '', 'offerUntil', '')
redis.call('ZREM', KEYS[3], ARGV[1])
redis.call('ZREM', KEYS[4], ARGV[1])
redis.call('DEL', KEYS[2])
return 'offline'`;

// KEYS: state, alive, geoAvailable. ARGV: id, tripId, offerUntilMs. 1 = reserved for this trip.
export const RESERVE = `
if redis.call('HGET', KEYS[1], 'status') ~= 'available' then return 0 end
if redis.call('EXISTS', KEYS[2]) == 0 then return 0 end
redis.call('HSET', KEYS[1], 'status', 'offered', 'tripId', ARGV[2], 'offerUntil', ARGV[3])
redis.call('ZREM', KEYS[3], ARGV[1])
return 1`;

// KEYS: state. ARGV: tripId. Repeating it for the same trip succeeds.
export const ASSIGN = `
local s = redis.call('HMGET', KEYS[1], 'status', 'tripId')
if s[2] ~= ARGV[1] then return 0 end
if s[1] == 'on_trip' then return 1 end
if s[1] ~= 'offered' then return 0 end
redis.call('HSET', KEYS[1], 'status', 'on_trip', 'offerUntil', '')
return 1`;

// KEYS: state, alive, geoAll, geoAvailable. ARGV: id, tripId. Frees only that trip.
export const RELEASE = `
local s = redis.call('HMGET', KEYS[1], 'status', 'tripId', 'lat', 'lng')
if s[2] ~= ARGV[2] or (s[1] ~= 'offered' and s[1] ~= 'on_trip') then return 0 end
if redis.call('EXISTS', KEYS[2]) == 1 then
  redis.call('HSET', KEYS[1], 'status', 'available', 'tripId', '', 'offerUntil', '')
  redis.call('GEOADD', KEYS[4], s[4], s[3], ARGV[1])
else
  redis.call('HSET', KEYS[1], 'status', 'offline', 'tripId', '', 'offerUntil', '')
  redis.call('ZREM', KEYS[3], ARGV[1])
  redis.call('ZREM', KEYS[4], ARGV[1])
end
return 1`;

// KEYS: state, alive, geoAll, geoAvailable. ARGV: id, nowMs. Heals drivers whose app or matcher vanished.
export const SWEEP_ONE = `
local s = redis.call('HMGET', KEYS[1], 'status', 'offerUntil', 'lat', 'lng')
if not s[1] then
  redis.call('ZREM', KEYS[3], ARGV[1])
  redis.call('ZREM', KEYS[4], ARGV[1])
  return 'gone'
end
local alive = redis.call('EXISTS', KEYS[2]) == 1
local staleOffer = s[1] == 'offered' and tonumber(s[2]) ~= nil and tonumber(s[2]) < tonumber(ARGV[2])
if staleOffer and alive then
  redis.call('HSET', KEYS[1], 'status', 'available', 'tripId', '', 'offerUntil', '')
  redis.call('GEOADD', KEYS[4], s[4], s[3], ARGV[1])
  return 'released'
end
if not alive and s[1] ~= 'on_trip' then
  redis.call('HSET', KEYS[1], 'status', 'offline', 'tripId', '', 'offerUntil', '')
  redis.call('ZREM', KEYS[3], ARGV[1])
  redis.call('ZREM', KEYS[4], ARGV[1])
  return 'offline'
end
return 'ok'`;

// KEYS: geoAll. ARGV: limit, state key prefix. Returns flat id, status, lng, lat quadruples.
export const LIST_ONLINE = `
local ids = redis.call('ZRANGE', KEYS[1], 0, tonumber(ARGV[1]) - 1)
local out = {}
for _, id in ipairs(ids) do
  local pos = redis.call('GEOPOS', KEYS[1], id)[1]
  local status = redis.call('HGET', ARGV[2] .. id, 'status') or 'offline'
  if pos then
    table.insert(out, id)
    table.insert(out, status)
    table.insert(out, pos[1])
    table.insert(out, pos[2])
  end
end
return out`;
