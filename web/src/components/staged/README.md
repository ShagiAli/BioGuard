# Staged components

Built, not mounted.

Each component here is part of the new design and is finished as a
component — typed, styled, and taking its data through props. What none
of them have yet is something real to talk to. `CommandSearch` needs an
endpoint that searches equipment, alerts and work orders together;
`QuickActions` needs the create flows it points at, none of which exist
as routes today.

They live here rather than in the live interface because a control that
looks capable and does nothing is worse than an absent one — and worse
in this application than in most, since people use it to decide whether
a ventilator has been serviced. Nothing on screen should imply a
capability the system lacks.

Wiring one up is a small job by design: import it, pass it the real
function, mount it. Nothing here needs rewriting first.

| Component | Blocked on | Stage |
| --- | --- | --- |
| `CommandSearch` | `GET /api/search?q=` across the three record types | 2 |
| `QuickActions` | Standalone routes for report-a-fault, new work order, record maintenance, scan | 4 |

Delete this directory when it is empty.
