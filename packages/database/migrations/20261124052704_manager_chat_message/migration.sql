CREATE TABLE "manager_chat_message" (
	"agent_id" uuid,
	"id" text,
	"seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "manager_chat_message_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"author_kind" text NOT NULL,
	"author_user_id" text,
	"author_name" text NOT NULL,
	"text" text NOT NULL,
	"attachments" jsonb DEFAULT '[]' NOT NULL,
	"thread_root" text,
	"broadcast" boolean DEFAULT false NOT NULL,
	"turn_id" uuid,
	"line_id" uuid,
	"client_key" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"edited_at" timestamp with time zone,
	CONSTRAINT "manager_chat_message_pkey" PRIMARY KEY("agent_id","id"),
	CONSTRAINT "manager_chat_message_author" CHECK ("author_kind" in ('person', 'agent') and ("author_kind" = 'person' or "author_user_id" is null)),
	CONSTRAINT "manager_chat_message_thread" CHECK (("thread_root" is null or "thread_root" <> "id") and ("broadcast" = false or "thread_root" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "manager_chat_message_client_key" ON "manager_chat_message" ("agent_id","client_key");--> statement-breakpoint
CREATE INDEX "manager_chat_message_agent_seq" ON "manager_chat_message" ("agent_id","seq");--> statement-breakpoint
CREATE INDEX "manager_chat_message_thread_seq" ON "manager_chat_message" ("agent_id","thread_root","seq") WHERE "thread_root" is not null;--> statement-breakpoint
CREATE INDEX "manager_chat_message_turn" ON "manager_chat_message" ("turn_id") WHERE "turn_id" is not null;--> statement-breakpoint
ALTER TABLE "manager_chat_message" ADD CONSTRAINT "manager_chat_message_agent_id_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agent"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "manager_chat_message" ADD CONSTRAINT "manager_chat_message_author_user_id_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "manager_chat_message" ADD CONSTRAINT "manager_chat_message_turn_id_turns_id_fkey" FOREIGN KEY ("turn_id") REFERENCES "turns"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "manager_chat_message" ADD CONSTRAINT "manager_chat_message_thread_root" FOREIGN KEY ("agent_id","thread_root") REFERENCES "manager_chat_message"("agent_id","id") ON DELETE CASCADE;