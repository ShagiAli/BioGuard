-- One head over all the engineers, rather than one head per ward.
--
-- The reviewer is the person the engineers answer to, so the department a
-- device sits in does not narrow what they may accept or send back. The
-- name is changed with the meaning: a role called HEAD_OF_DEPARTMENT that
-- is not scoped to a department is a trap for whoever reads it next.
ALTER TYPE "Role" RENAME VALUE 'HEAD_OF_DEPARTMENT' TO 'HEAD_OF_ENGINEERING';
