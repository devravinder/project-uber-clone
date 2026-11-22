-- Each service owns one database; no role may connect to another service's database.
CREATE ROLE riders_svc LOGIN PASSWORD 'riders';
CREATE ROLE drivers_svc LOGIN PASSWORD 'drivers';
CREATE ROLE trips_svc LOGIN PASSWORD 'trips';

CREATE DATABASE riders OWNER riders_svc;
CREATE DATABASE drivers OWNER drivers_svc;
CREATE DATABASE trips OWNER trips_svc;

-- By default every role may connect to every database.
REVOKE CONNECT ON DATABASE riders FROM PUBLIC;
REVOKE CONNECT ON DATABASE drivers FROM PUBLIC;
REVOKE CONNECT ON DATABASE trips FROM PUBLIC;
