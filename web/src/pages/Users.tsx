/**
 * The people the system writes to.
 *
 * Every reminder, every alert and every part request is addressed to a
 * role, and a role is only as useful as the address behind it. Until
 * this page existed, correcting one meant a query against the database —
 * which put the most ordinary administrative task in the hands of
 * whoever had the connection string.
 *
 * Deliberately not here: passwords. Nobody sets another person's
 * password, not even an administrator. A corrected address goes through
 * the reset flow instead, so changing somebody's email hands them their
 * account rather than taking it.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Pencil, X } from "lucide-react";
import { api, ApiError, titleCase } from "../lib/api";
import { useAuth } from "../auth";
import { Badge, Button, Card, ErrorNote, Spinner } from "../components/ui";

type Role = "ADMIN" | "MANAGER" | "HEAD_OF_ALERTS" | "ENGINEER" | "STAFF";

interface Person {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  isActive: boolean;
  department: { id: string; name: string } | null;
}

const ROLE_LABELS: Record<Role, string> = {
  ADMIN: "Administrator",
  MANAGER: "Manager",
  HEAD_OF_ALERTS: "Head of alerts",
  ENGINEER: "Engineer",
  STAFF: "Ward staff",
};

/** What each role is written to about, so the list explains itself. */
const ROLE_RECEIVES: Record<Role, string> = {
  ADMIN: "Emergencies, and parts waiting to be ordered",
  MANAGER: "Emergencies, and parts waiting to be ordered",
  HEAD_OF_ALERTS: "Every fault reported, as it is raised",
  ENGINEER: "Their own devices falling due, and faults assigned to them",
  STAFF: "What happened to the faults they reported",
};

export function Users() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState("");

  const query = useQuery({
    queryKey: ["users"],
    queryFn: () => api.get<{ rows: Person[] }>("/api/users"),
  });

  // Departments come from the form's options endpoint, which is gated to
  // the same two roles — so asking for it here needs no new permission.
  const options = useQuery({
    queryKey: ["equipment", "options"],
    queryFn: () =>
      api.get<{ departments: { id: string; name: string }[] }>("/api/equipment/meta/options"),
  });

  const save = useMutation({
    mutationFn: ({
      id,
      ...body
    }: { id: string } & Partial<Person> & { departmentId?: string | null }) =>
      api.patch<Person>(`/api/users/${id}`, body),
    onSuccess: () => {
      setEditing(null);
      setError("");
      qc.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Could not save."),
  });

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-xl font-medium text-slate-900">People</h1>
      <p className="mt-1 text-sm text-slate-500">
        Who the system writes to, and where. Changing an address does not change a password — the
        person sets that themselves through “Forgot password”.
      </p>

      {error && (
        <div className="mt-4">
          <ErrorNote message={error} />
        </div>
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
                {query.data.rows.map((person) =>
                  editing === person.id ? (
                    <EditRow
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
                          <Badge tone="slate">Inactive</Badge>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <button
                          onClick={() => {
                            setEditing(person.id);
                            setError("");
                          }}
                          className="flex cursor-pointer items-center gap-1.5 text-xs text-brand-700 transition hover:text-brand-900"
                        >
                          <Pencil size={13} /> Edit
                        </button>
                      </td>
                    </tr>
                  )
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function EditRow({
  person,
  departments,
  busy,
  onCancel,
  onSave,
}: {
  person: Person;
  departments: { id: string; name: string }[];
  busy: boolean;
  onCancel: () => void;
  onSave: (changes: {
    email: string;
    fullName: string;
    role: Role;
    departmentId: string | null;
    isActive: boolean;
  }) => void;
}) {
  const [email, setEmail] = useState(person.email);
  const [fullName, setFullName] = useState(person.fullName);
  const [role, setRole] = useState<Role>(person.role);
  const [departmentId, setDepartmentId] = useState(person.department?.id ?? "");
  const [isActive, setIsActive] = useState(person.isActive);

  const cell = "px-4 py-2";
  const input =
    "w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm outline-none transition focus:border-brand-500";

  return (
    <tr className="bg-brand-50/40">
      <td className={cell}>
        <input className={input} value={fullName} onChange={(e) => setFullName(e.target.value)} />
      </td>
      <td className={cell}>
        <input
          className={`${input} font-mono text-xs`}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </td>
      <td className={cell}>
        <select className={input} value={role} onChange={(e) => setRole(e.target.value as Role)}>
          {(Object.keys(ROLE_LABELS) as Role[]).map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </select>
      </td>
      <td className={`hidden lg:table-cell ${cell}`}>
        <select
          className={input}
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
