-- A thread of an agent on no task, a Manager's, keeps its files on the thread itself, naming no task.
ALTER TABLE "attachment" DROP CONSTRAINT "attachment_inbox_file_task";
