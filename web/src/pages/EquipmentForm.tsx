/**
 * Registering a device, and correcting one.
 *
 * One form for both, because the fields are the same and two forms
 * would drift. A page rather than a dialog: there are fifteen fields and
 * a schedule to decide, which is more than a modal should ask for.
 *
 * Deliberately absent are the fields the server owns — tag, QR token,
 * next due date — and operational status, which has its own control on
 * the detail page because taking a device out of service is a different
 * event from correcting its record.
 */
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { api, ApiError, type EquipmentDetail } from "../lib/api";
import { Button, Card, ErrorNote, Spinner } from "../components/ui";

interface Options {
  categories: { id: string; name: string }[];
  manufacturers: { id: string; name: string }[];
  departments: { id: string; name: string }[];
  rooms: { id: string; code: string; building: { name: string } }[];
  engineers: { id: string; fullName: string }[];
}

/** Every value a string, because that is what an input gives you. */
interface FormState {
  name: string;
  assetNo: string;
  serialNo: string;
  model: string;
  categoryId: string;
  manufacturerId: string;
  departmentId: string;
  roomId: string;
  engineerId: string;
  criticality: string;
  intervalDays: string;
  intervalSource: string;
  scheduleMode: string;
  installedAt: string;
  purchasedAt: string;
  purchasePrice: string;
  warrantyEndsAt: string;
}

const EMPTY: FormState = {
  name: "",
  assetNo: "",
  serialNo: "",
  model: "",
  categoryId: "",
  manufacturerId: "",
  departmentId: "",
  roomId: "",
  engineerId: "",
  criticality: "MEDIUM",
  intervalDays: "180",
  intervalSource: "MANUFACTURER",
  scheduleMode: "GRACE",
  installedAt: "",
  purchasedAt: "",
  purchasePrice: "",
  warrantyEndsAt: "",
};

/** A date input wants YYYY-MM-DD; the API sends an ISO timestamp. */
const asDateInput = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : "");

export function EquipmentForm() {
  const { id } = useParams();
  const editing = Boolean(id);
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [form, setForm] = useState<FormState>(EMPTY);
  const [error, setError] = useState("");

  const options = useQuery({
    queryKey: ["equipment-options"],
    queryFn: () => api.get<Options>("/api/equipment/meta/options"),
  });

  const existing = useQuery({
    queryKey: ["equipment", id],
    queryFn: () => api.get<EquipmentDetail>(`/api/equipment/${id}`),
    enabled: editing,
  });

  /**
   * Fills the form the first time the device arrives, and only then.
   *
   * Adjusted during render rather than in an effect: reacting to state
   * with more state renders once with the empty form and again with the
   * real one, and the flash is visible. Tracking which record the form
   * was filled from also means a background refetch cannot wipe what
   * somebody has typed since.
   */
  const loaded = existing.data;
  const [filledFrom, setFilledFrom] = useState<string | null>(null);
  if (loaded && filledFrom !== loaded.id) {
    setFilledFrom(loaded.id);
    setForm({
      name: loaded.name,
      assetNo: loaded.assetNo,
      serialNo: loaded.serialNo,
      model: loaded.model,
      categoryId: loaded.category.id,
      manufacturerId: loaded.manufacturer.id,
      departmentId: loaded.department.id,
      roomId: loaded.room?.id ?? "",
      engineerId: loaded.engineer?.id ?? "",
      criticality: loaded.criticality,
      intervalDays: String(loaded.intervalDays),
      intervalSource: loaded.intervalSource,
      scheduleMode: loaded.scheduleMode,
      installedAt: asDateInput(loaded.installedAt),
      purchasedAt: asDateInput(loaded.purchasedAt),
      purchasePrice: loaded.purchasePrice ?? "",
      warrantyEndsAt: asDateInput(loaded.warrantyEndsAt),
    });
  }

  const set = (key: keyof FormState) => (value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const save = useMutation({
    mutationFn: () => {
      // Empty strings mean "not set", which the API reads as null. Sent
      // as "" they would fail validation on a field nobody filled in.
      const body: Record<string, unknown> = {
        name: form.name,
        assetNo: form.assetNo,
        serialNo: form.serialNo,
        model: form.model,
        categoryId: form.categoryId,
        manufacturerId: form.manufacturerId,
        departmentId: form.departmentId,
        roomId: form.roomId || null,
        engineerId: form.engineerId || null,
        criticality: form.criticality,
        intervalDays: Number(form.intervalDays),
        intervalSource: form.intervalSource,
        scheduleMode: form.scheduleMode,
        installedAt: form.installedAt || null,
        purchasedAt: form.purchasedAt || null,
        purchasePrice: form.purchasePrice === "" ? null : Number(form.purchasePrice),
        warrantyEndsAt: form.warrantyEndsAt || null,
      };
      return editing
        ? api.patch<{ id: string }>(`/api/equipment/${id}`, body)
        : api.post<{ id: string }>("/api/equipment", body);
    },
    onSuccess: (saved) => {
      qc.invalidateQueries({ queryKey: ["equipment"] });
      navigate(`/equipment/${saved.id}`);
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : "Could not save this device.");
    },
  });

  if (editing && existing.isLoading) return <Spinner label="Loading the device" />;
  if (editing && existing.isError) return <ErrorNote message="Could not load this device." />;

  const opts = options.data;
  const required = form.name && form.assetNo && form.categoryId && form.departmentId;

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        to={editing ? `/equipment/${id}` : "/equipment"}
        className="mb-4 flex w-fit items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800"
      >
        <ArrowLeft size={15} /> {editing ? "Back to the device" : "All equipment"}
      </Link>

      <h1 className="text-xl font-medium text-slate-900">
        {editing ? "Edit device" : "Register a device"}
      </h1>
      <p className="mt-1 text-sm text-slate-500">
        {editing
          ? "Corrections to the record. Servicing and status are recorded on the device page."
          : "A new device joins the maintenance programme immediately: its first service falls one interval from installation."}
      </p>

      <Card className="mt-5 p-5">
        <Section title="Identity">
          <Text label="Name" value={form.name} onChange={set("name")} required />
          <Text label="Asset number" value={form.assetNo} onChange={set("assetNo")} required />
          <Text label="Model" value={form.model} onChange={set("model")} />
          <Text label="Serial number" value={form.serialNo} onChange={set("serialNo")} />
          <Select
            label="Category"
            value={form.categoryId}
            onChange={set("categoryId")}
            options={opts?.categories.map((c) => ({ value: c.id, label: c.name })) ?? []}
            required
          />
          <Select
            label="Manufacturer"
            value={form.manufacturerId}
            onChange={set("manufacturerId")}
            options={opts?.manufacturers.map((m) => ({ value: m.id, label: m.name })) ?? []}
            required
          />
        </Section>

        <Section title="Where it lives">
          <Select
            label="Department"
            value={form.departmentId}
            onChange={set("departmentId")}
            options={opts?.departments.map((d) => ({ value: d.id, label: d.name })) ?? []}
            required
          />
          <Select
            label="Room"
            value={form.roomId}
            onChange={set("roomId")}
            options={
              opts?.rooms.map((r) => ({
                value: r.id,
                label: `${r.building.name} · ${r.code}`,
              })) ?? []
            }
            allowEmpty="Not assigned"
          />
          <Select
            label="Responsible engineer"
            value={form.engineerId}
            onChange={set("engineerId")}
            options={opts?.engineers.map((e) => ({ value: e.id, label: e.fullName })) ?? []}
            allowEmpty="Unassigned"
          />
          <Select
            label="Criticality"
            value={form.criticality}
            onChange={set("criticality")}
            options={["CRITICAL", "HIGH", "MEDIUM", "LOW"].map((c) => ({
              value: c,
              label: c.charAt(0) + c.slice(1).toLowerCase(),
            }))}
          />
        </Section>

        <Section
          title="Maintenance schedule"
          hint="Changing the interval moves the next service with it, counted from the last one."
        >
          <Text
            label="Service interval (days)"
            value={form.intervalDays}
            onChange={set("intervalDays")}
            type="number"
            required
          />
          <Select
            label="Interval set by"
            value={form.intervalSource}
            onChange={set("intervalSource")}
            options={[
              { value: "MANUFACTURER", label: "Manufacturer" },
              { value: "HOSPITAL_POLICY", label: "Hospital policy" },
              { value: "RISK_BASED", label: "Risk based" },
            ]}
          />
          <Select
            label="Schedule mode"
            value={form.scheduleMode}
            onChange={set("scheduleMode")}
            options={[
              { value: "GRACE", label: "Grace — re-base if late" },
              { value: "ANCHORED", label: "Anchored — fixed calendar" },
            ]}
          />
        </Section>

        <Section title="Lifecycle">
          <Text
            label="Installed"
            value={form.installedAt}
            onChange={set("installedAt")}
            type="date"
          />
          <Text
            label="Purchased"
            value={form.purchasedAt}
            onChange={set("purchasedAt")}
            type="date"
          />
          <Text
            label="Purchase price"
            value={form.purchasePrice}
            onChange={set("purchasePrice")}
            type="number"
          />
          <Text
            label="Warranty ends"
            value={form.warrantyEndsAt}
            onChange={set("warrantyEndsAt")}
            type="date"
          />
        </Section>

        {error && <ErrorNote message={error} />}

        <div className="mt-5 flex items-center gap-3 border-t border-slate-200 pt-4">
          <Button onClick={() => save.mutate()} disabled={!required || save.isPending}>
            {save.isPending ? "Saving…" : editing ? "Save changes" : "Register device"}
          </Button>
          <Link
            to={editing ? `/equipment/${id}` : "/equipment"}
            className="text-sm text-slate-500 hover:text-slate-800"
          >
            Cancel
          </Link>
        </div>
      </Card>
    </div>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-6 last:mb-0">
      <h2 className="text-sm font-medium text-slate-800">{title}</h2>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
      <div className="mt-3 grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

function Text({
  label,
  value,
  onChange,
  type = "text",
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-xs uppercase tracking-wide text-slate-500">
        {label}
        {required && <span className="text-rose-500"> *</span>}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-500"
      />
    </label>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
  allowEmpty,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  allowEmpty?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-xs uppercase tracking-wide text-slate-500">
        {label}
        {required && <span className="text-rose-500"> *</span>}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full cursor-pointer rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500"
      >
        {(allowEmpty || !value) && <option value="">{allowEmpty ?? "Choose…"}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
