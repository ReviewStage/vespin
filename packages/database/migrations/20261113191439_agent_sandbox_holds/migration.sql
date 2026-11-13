CREATE TABLE "agent_sandbox_beat" (
	"sandbox_name" text,
	"kind" text,
	"holder" text,
	"beat_at" timestamp with time zone NOT NULL,
	CONSTRAINT "agent_sandbox_beat_pkey" PRIMARY KEY("sandbox_name","kind","holder")
);
--> statement-breakpoint
CREATE TABLE "agent_sandbox_terminal" (
	"sandbox_name" text,
	"terminal_id" text,
	"opened_at" timestamp with time zone NOT NULL,
	CONSTRAINT "agent_sandbox_terminal_pkey" PRIMARY KEY("sandbox_name","terminal_id")
);
--> statement-breakpoint
ALTER TABLE "agent_sandbox_beat" ADD CONSTRAINT "agent_sandbox_beat_sandbox_name_agent_sandbox_sandbox_name_fkey" FOREIGN KEY ("sandbox_name") REFERENCES "agent_sandbox"("sandbox_name") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "agent_sandbox_terminal" ADD CONSTRAINT "agent_sandbox_terminal_3TQdXaPtODoS_fkey" FOREIGN KEY ("sandbox_name") REFERENCES "agent_sandbox"("sandbox_name") ON DELETE CASCADE;