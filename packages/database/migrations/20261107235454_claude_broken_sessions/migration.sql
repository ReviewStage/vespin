CREATE TABLE "claude_broken_sessions" (
	"conversation_id" uuid,
	"session_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "claude_broken_sessions_pkey" PRIMARY KEY("conversation_id","session_id")
);
--> statement-breakpoint
ALTER TABLE "claude_broken_sessions" ADD CONSTRAINT "claude_broken_sessions_conversation_id_conversations_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE;