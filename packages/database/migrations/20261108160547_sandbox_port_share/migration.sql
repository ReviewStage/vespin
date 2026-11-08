CREATE TABLE "sandbox_port_share" (
	"session_id" text PRIMARY KEY,
	"port" integer NOT NULL,
	"shared_at" timestamp with time zone NOT NULL
);
