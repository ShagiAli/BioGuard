/**
 * The people the system writes to, and what happens when they change.
 *
 * Every reminder, alert and part request is addressed to a role, and a
 * role is only as useful as the address behind it. Correcting one used
 * to mean a query against the database, which put the most ordinary
 * administrative task in the hands of whoever had the connection string.
 *
 * Two things are deliberately impossible here.
 *
 * Nobody sets another person's password — not even an administrator. A
 * new colleague is invited and sets their own, so the only person who
 * ever knows it is the person it belongs to.
 *
 * And nobody is edited into being somebody else. When an engineer leaves
 * you do not point their account at their replacement: that account
 * signed five services, and moving it would say the new engineer did
 * work before they were hired. The leaver's live work is handed over,
 * their finished work stays theirs, and their account is closed.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, ChevronUp, Pencil, Trash2, UserPlus, X } from "lucide-react";
import { api, ApiError, titleCase } from "../lib/api";
import { useAuth } from "../auth";
import { Badge, Button, Card, ErrorNote, Spinner } from "../components/ui";

type Role = "ADMIN" | "MANAGER" | "HEAD_OF_ALERTS" | "HEAD_OF_ENGINEERING" | "ENGINEER" | "STAFF";

interface Person {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  isActive: boolean;
  department: { id: string; name: string } | null;
}

interface Department {
  id: string;
  name: string;
}

const ROLE_LABELS: Record<Role, string> = {
  ADMIN: "Administrator",
  MANAGER: "Manager",
  HEAD_OF_ALERTS: "Head of alerts",
  HEAD_OF_ENGINEERING: "Head of engineering",
  ENGINEER: "Engineer",
  STAFF: "Ward staff",
};

/** What each role is written to about, so the list explains itself. */
const ROLE_RECEIVES: Record<Role, string> = {
  ADMIN: "Emergencies, and parts waiting to be ordered",
  MANAGER: "Emergencies, and parts waiting to be ordered",
  HEAD_OF_ALERTS: "Every fault reported, as it is raised",
  HEAD_OF_ENGINEERING: "Every finished repair, waiting to be accepted",
  ENGINEER: "Their own devices falling due, and faults assigned to them",
  STAFF: "What happened to the faults they reported",
};

const INPUT =
  "w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm outline-none transition focus:border-brand-500";

export function Users() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [editing, setEditing] = useState<string | null>(null);
  const [showFormer, setShowFormer] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  /** Set when a deactivation was refused because work is still held. */
  /*
   * A refused edit that turns into a handover. Remembers what was being
   * attempted, because handing the work over is only the means: the
   * point was to close the account, or to change the role, and the page
   * should finish that rather than make somebody ask twice.
   */
  const [leaving, setLeaving] = useState<{
    person: Person;
    reason: string;
    changes: Record<string, unknown>;
    purpose: "leave" | "role";
  } | null>(null);

  const query = useQuery({
    queryKey: ["users"],
    queryFn: () => api.get<{ rows: Person[]; assignableRoles: Role[] }>("/api/users"),
  });

  // Departments come from the form's options endpoint, which is gated to
  // the same two roles — so asking for it here needs no new permission.
  const options = useQuery({
    queryKey: ["equipment", "options"],
    queryFn: () => api.get<{ departments: Department[] }>("/api/equipment/meta/options"),
  });

  const done = () => {
    setEditing(null);
    setAdding(false);
    setLeaving(null);
    setError("");
    qc.invalidateQueries({ queryKey: ["users"] });
  };

  const save = useMutation({
    mutationFn: ({ id, ...body }: { id: string } & Record<string, unknown>) =>
      api.patch<Person>(`/api/users/${id}`, body),
    onSuccess: done,
    onError: (err, vars) => {
      /*
       * A refusal over held work is not an error to report and forget —
       * it is the start of a handover. Recognised by the workload the
       * server sends with it, not guessed from what was asked: the same
       * edit can be refused for other reasons, like somebody changing
       * their own role, and those must not open a handover.
       */
      const person = query.data?.rows.find((r) => r.id === vars.id);
      const heldWork =
        err instanceof ApiError &&
        err.status === 409 &&
        typeof err.body === "object" &&
        err.body !== null &&
        "workload" in err.body;

      if (heldWork && person) {
        const { id: _id, ...changes } = vars;
        setLeaving({
          person,
          reason: err.message,
          changes,
          purpose: vars.isActive === false ? "leave" : "role",
        });
        setError("");
        return;
      }
      setError(err instanceof ApiError ? err.message : "Could not save.");
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/users/${id}`),
    onSuccess: () => {
      setConfirmDelete(null);
      done();
    },
    onError: (err) => {
      // The refusal carries the counts. Showing it verbatim is the whole
      // point: "cannot delete" says nothing, "21 services signed" says
      // why the answer will not change.
      setConfirmDelete(null);
      setError(err instanceof ApiError ? err.message : "Could not delete this account.");
    },
  });

  const invite = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post<Person>("/api/users", body),
    onSuccess: done,
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : "Could not add this person."),
  });

  const handover = useMutation({
    mutationFn: async ({
      fromId,
      toId,
      changes,
    }: {
      fromId: string;
      toId: string;
      changes: Record<string, unknown>;
    }) => {
      await api.post(`/api/users/${fromId}/handover`, { toId });
      // The handover is the means. Whatever was being attempted — closing
      // the account or changing the role — is the job, so finish it
      // rather than leaving somebody to press the same button again.
      await api.patch(`/api/users/${fromId}`, changes);
    },
    onSuccess: done,
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : "Could not hand the work over."),
  });

  const engineers = (query.data?.rows ?? []).filter((r) => r.role === "ENGINEER" && r.isActive);

  /*
   * People who have left are kept, not hidden away and forgotten: the
   * record still points at them, and a name that resolves to nothing is
   * worse than a name marked closed. But they are no longer the roster,
   * so they sit behind a count rather than between the colleagues
   * somebody actually came here to find.
   */
  /*
   * Decided by the server and read here, never worked out a second time.
   * Also answers which rows this person may edit: somebody who cannot
   * assign a role cannot be allowed to edit a person holding it, or they
   * could edit that person out of it.
   */
  const assignable = query.data?.assignableRoles ?? [];
  const mayManage = (role: Role) => assignable.includes(role);

  const all = query.data?.rows ?? [];
  const current = all.filter((r) => r.isActive);
  const former = all.filter((r) => !r.isActive);
  const shown = showFormer ? [...current, ...former] : current;

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-medium text-slate-900">People</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            Who the system writes to, and where. Nobody here sets anybody else’s password — a new
            colleague is invited and chooses their own.
          </p>
        </div>
        {!adding && (
          <Button
            onClick={() => {
              setAdding(true);
              setError("");
            }}
          >
            <UserPlus size={14} /> Add person
          </Button>
        )}
      </div>

      {error && (
        <div className="mt-4">
          <ErrorNote message={error} />
        </div>
      )}

      {leaving && (
        <Handover
          person={leaving.person}
          reason={leaving.reason}
          purpose={leaving.purpose}
          engineers={engineers.filter((e) => e.id !== leaving.person.id)}
          busy={handover.isPending}
          onCancel={() => setLeaving(null)}
          onConfirm={(toId) =>
            handover.mutate({ fromId: leaving.person.id, toId, changes: leaving.changes })
          }
        />
      )}

      {adding && (
        <AddPerson
          roles={assignable}
          departments={options.data?.departments ?? []}
          busy={invite.isPending}
          onCancel={() => {
            setAdding(false);
            setError("");
          }}
          onSubmit={(body) => invite.mutate(body)}
        />
      )}

      <Card className="mt-4 overflow-hidden">
        {query.isError ? (
          <ErrorNote message="Could not load the people list." />
        ) : !query.data ? (
          <Spinner label="Loading people" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Name</th>
                  <th className="px-4 py-2.5 font-medium">Email</th>
                  <th className="px-4 py-2.5 font-medium">Role</th>
                  <th className="hidden px-4 py-2.5 font-medium lg:table-cell">Department</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="w-24 px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {shown.map((person) =>
                  editing === person.id ? (
                    <EditRow
                      roles={assignable}
                      key={person.id}
                      person={person}
                      departments={options.data?.departments ?? []}
                      busy={save.isPending}
                      onCancel={() => {
                        setEditing(null);
                        setError("");
                      }}
                      onSave={(changes) => save.mutate({ id: person.id, ...changes })}
                    />
                  ) : (
                    <tr key={person.id} className={person.isActive ? "" : "bg-slate-50/60"}>
                      <td className="px-4 py-2.5 text-slate-800">
                        {person.fullName}
                        {person.id === user?.id && (
                          <span className="ml-2 text-xs text-slate-400">you</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs text-slate-600">
                        {person.email}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="text-slate-700">{ROLE_LABELS[person.role]}</div>
                        <div className="text-xs text-slate-400">{ROLE_RECEIVES[person.role]}</div>
                      </td>
                      <td className="hidden px-4 py-2.5 text-slate-600 lg:table-cell">
                        {person.department?.name ?? "—"}
                      </td>
                      <td className="px-4 py-2.5">
                        {person.isActive ? (
                          <Badge tone="emerald">Active</Badge>
                        ) : (
                          <Badge tone="slate">Left</Badge>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-3">
                          {mayManage(person.role) && (
                            <button
                              onClick={() => {
                                setEditing(person.id);
                                setError("");
                                setLeaving(null);
                                setConfirmDelete(null);
                              }}
                              className="flex cursor-pointer items-center gap-1.5 text-xs text-brand-700 transition hover:text-brand-900"
                            >
                              <Pencil size={13} /> Edit
                            </button>
                          )}

                          {/*
                            Only on a closed account, and only ever as a
                            second press. The server refuses an active
                            one anyway; offering it here would be a
                            button whose whole purpose is to be refused.
                          */}
                          {!person.isActive &&
                            person.id !== user?.id &&
                            mayManage(person.role) &&
                            (confirmDelete === person.id ? (
                              <button
                                onClick={() => remove.mutate(person.id)}
                                disabled={remove.isPending}
                                className="flex cursor-pointer items-center gap-1.5 text-xs font-medium text-rose-700 transition hover:text-rose-900"
                              >
                                <Trash2 size={13} /> Confirm
                              </button>
                            ) : (
                              <button
                                onClick={() => {
                                  setConfirmDelete(person.id);
                                  setError("");
                                }}
                                className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-400 transition hover:text-rose-700"
                              >
                                <Trash2 size={13} /> Delete
                              </button>
                            ))}
                        </div>
                      </td>
                    </tr>
                  )
                )}
              </tbody>
            </table>
          </div>
        )}

        {/*
          Below the roster rather than above it, and closed by default.
          Somebody opening this page is looking for a colleague who works
          here; people who have left are a different question, asked less
          often, and they should not be the first thing read.

          Absent entirely when nobody has left, because a control that
          reveals nothing still has to be understood before it can be
          ignored.
        */}
        {former.length > 0 && (
          <button
            onClick={() => setShowFormer((v) => !v)}
            className="flex w-full cursor-pointer items-center justify-center gap-1.5 border-t border-slate-100 px-4 py-2.5 text-xs text-slate-500 transition hover:bg-slate-50 hover:text-slate-800"
          >
            {showFormer ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            {showFormer ? "Hide" : "Show"} {former.length} former{" "}
            {former.length === 1 ? "colleague" : "colleagues"}
          </button>
        )}
      </Card>
    </div>
  );
}

/**
 * The handover, offered at the moment somebody tries to close an account
 * that still holds work — which is when they are thinking about it.
 */
function Handover({
  purpose,
  person,
  reason,
  engineers,
  busy,
  onCancel,
  onConfirm,
}: {
  purpose: "leave" | "role";
  person: Person;
  reason: string;
  engineers: Person[];
  busy: boolean;
  onCancel: () => void;
  onConfirm: (toId: string) => void;
}) {
  const [toId, setToId] = useState("");

  return (
    <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
      <div className="text-sm font-medium text-amber-900">
        {purpose === "leave"
          ? `${person.fullName} cannot leave yet`
          : `${person.fullName}'s role cannot change yet`}
      </div>
      <p className="mt-1 text-sm text-amber-900">{reason}</p>
      <p className="mt-2 max-w-2xl text-xs leading-relaxed text-amber-800">
        Their completed services stay theirs — that is the record of who did the work. Only the
        devices they watch and the repairs still open move across.
      </p>

      {engineers.length === 0 ? (
        <p className="mt-3 text-sm text-amber-900">
          There is no other active engineer to take this on. Add one first.
        </p>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select
            className={`${INPUT} max-w-xs bg-white`}
            value={toId}
            onChange={(e) => setToId(e.target.value)}
          >
            <option value="">Hand over to…</option>
            {engineers.map((e) => (
              <option key={e.id} value={e.id}>
                {e.fullName}
                {e.department ? ` — ${e.department.name}` : ""}
              </option>
            ))}
          </select>
          <Button onClick={() => onConfirm(toId)} disabled={busy || !toId}>
            <Check size={13} />{" "}
            {purpose === "leave"
              ? "Hand over and close the account"
              : "Hand over and change the role"}
          </Button>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}

function AddPerson({
  roles,
  departments,
  busy,
  onCancel,
  onSubmit,
}: {
  roles: Role[];
  departments: Department[];
  busy: boolean;
  onCancel: () => void;
  onSubmit: (body: Record<string, unknown>) => void;
}) {
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<Role>("ENGINEER");
  const [departmentId, setDepartmentId] = useState("");

  return (
    <Card className="mt-4 p-4">
      <div className="text-sm font-medium text-slate-800">Add a person</div>
      <p className="mt-1 text-xs text-slate-500">
        They receive an invitation and set their own password. You never see it.
      </p>

      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block">
          <span className="text-xs uppercase tracking-wide text-slate-500">Full name</span>
          <input
            className={`${INPUT} mt-1`}
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="text-xs uppercase tracking-wide text-slate-500">Email</span>
          <input
            className={`${INPUT} mt-1`}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="text-xs uppercase tracking-wide text-slate-500">Role</span>
          <select
            className={`${INPUT} mt-1`}
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
          >
            {roles.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs uppercase tracking-wide text-slate-500">Department</span>
          <select
            className={`${INPUT} mt-1`}
            value={departmentId}
            onChange={(e) => setDepartmentId(e.target.value)}
          >
            <option value="">None</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {titleCase(d.name)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-4 flex items-center gap-2">
        <Button
          onClick={() => onSubmit({ email, fullName, role, departmentId: departmentId || null })}
          disabled={busy || !email.trim() || !fullName.trim()}
        >
          <UserPlus size={13} /> Send the invitation
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </Card>
  );
}

function EditRow({
  roles,
  person,
  departments,
  busy,
  onCancel,
  onSave,
}: {
  roles: Role[];
  person: Person;
  departments: Department[];
  busy: boolean;
  onCancel: () => void;
  onSave: (changes: Record<string, unknown>) => void;
}) {
  const [email, setEmail] = useState(person.email);
  const [fullName, setFullName] = useState(person.fullName);
  const [role, setRole] = useState<Role>(person.role);
  const [departmentId, setDepartmentId] = useState(person.department?.id ?? "");
  const [isActive, setIsActive] = useState(person.isActive);

  const cell = "px-4 py-2";

  return (
    <tr className="bg-brand-50/40">
      <td className={cell}>
        <input className={INPUT} value={fullName} onChange={(e) => setFullName(e.target.value)} />
      </td>
      <td className={cell}>
        <input
          className={`${INPUT} font-mono text-xs`}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </td>
      <td className={cell}>
        <select className={INPUT} value={role} onChange={(e) => setRole(e.target.value as Role)}>
          {roles.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </select>
      </td>
      <td className={`hidden lg:table-cell ${cell}`}>
        <select
          className={INPUT}
          value={departmentId}
          onChange={(e) => setDepartmentId(e.target.value)}
        >
          <option value="">None</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {titleCase(d.name)}
            </option>
          ))}
        </select>
      </td>
      <td className={cell}>
        <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-600">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
          />
          Active
        </label>
      </td>
      <td className={cell}>
        <div className="flex items-center gap-1">
          <Button
            onClick={() =>
              onSave({ email, fullName, role, departmentId: departmentId || null, isActive })
            }
            disabled={busy || !email.trim() || !fullName.trim()}
          >
            <Check size={13} /> Save
          </Button>
          <button
            onClick={onCancel}
            disabled={busy}
            className="cursor-pointer rounded p-1.5 text-slate-400 transition hover:text-slate-700"
            aria-label="Cancel"
          >
            <X size={15} />
          </button>
        </div>
      </td>
    </tr>
  );
}
