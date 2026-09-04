/**
 * Saved views: a filtered list somebody wants back tomorrow.
 *
 * The stored value is the query string the list page already keeps in
 * the address bar, so saving one is bookmarking and replaying one is
 * navigation. That is deliberate — it means a saved view can do nothing
 * a typed URL could not, because every list endpoint parses the same
 * string with a strict schema and refuses whatever it does not know.
 *
 * Views are private to their owner. Sharing one would need an answer to
 * who may see which departments, and the scoping rules already answer
 * that per request against the person asking, rather than once against
 * whoever saved the string.
 */
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { requireAuth } from "../../middleware/auth.js";

export const viewsRouter = Router();

/** The lists that have filters worth saving. */
const RESOURCES = ["equipment", "alerts", "work-orders", "activity"] as const;

const createSchema = z
  .object({
    name: z.string().min(1).max(60),
    resource: z.enum(RESOURCES),
    /**
     * Bounded because it is replayed into a URL. The length is generous
     * for a real filter set and far short of anything that would make a
     * request line awkward.
     */
    query: z.string().max(600),
  })
  .strict();

const listQuery = z.object({ resource: z.enum(RESOURCES).optional() }).strict();

viewsRouter.get("/", requireAuth, async (req, res) => {
  const parsed = listQuery.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: "Unknown list." });

  const views = await prisma.savedView.findMany({
    where: {
      ownerId: req.user!.id,
      ...(parsed.data.resource ? { resource: parsed.data.resource } : {}),
    },
    orderBy: { name: "asc" },
    select: { id: true, name: true, resource: true, query: true, createdAt: true },
  });

  res.json({ views });
});

viewsRouter.post("/", requireAuth, async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Name the view." });
  }

  // Saving over a name replaces it, which is what someone adjusting a
  // filter and pressing save again means. Refusing would leave them
  // deleting the old one first for no reason.
  const view = await prisma.savedView.upsert({
    where: {
      ownerId_resource_name: {
        ownerId: req.user!.id,
        resource: parsed.data.resource,
        name: parsed.data.name,
      },
    },
    create: { ...parsed.data, ownerId: req.user!.id },
    update: { query: parsed.data.query },
    select: { id: true, name: true, resource: true, query: true, createdAt: true },
  });

  res.status(201).json(view);
});

viewsRouter.delete("/:id", requireAuth, async (req, res) => {
  const id = z.uuid().safeParse(req.params.id);
  if (!id.success) return res.status(404).json({ error: "View not found." });

  // Scoped to the owner in the delete itself, so one person cannot
  // remove another's view by guessing an id.
  const { count } = await prisma.savedView.deleteMany({
    where: { id: id.data, ownerId: req.user!.id },
  });
  if (count === 0) return res.status(404).json({ error: "View not found." });

  res.status(204).end();
});
