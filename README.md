# @aykenet/n8n-nodes-decared

This is an n8n community node. It lets you use [DeCAred](https://decared.com) in your n8n workflows.

DeCAred issues the *documento de control administrativo* (DeCA), route sheets and carriage letters that Spanish road
hauliers must carry, and sends them to the driver's phone. With this package you can create DeCA drafts from your ERP
or order system, keep the address book in sync, and start workflows when documents are issued, corrected, closed or
annulled.

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/sustainable-use-license/) workflow automation platform.

[Installation](#installation) · [Operations](#operations) · [Credentials](#credentials) · [Compatibility](#compatibility) · [Usage](#usage) · [Resources](#resources)

## Installation

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) in the n8n community
nodes documentation and install `@aykenet/n8n-nodes-decared`.

## Operations

**DeCAred** node

| Resource | Operations |
|---|---|
| Document | Get, Get Many (filter by reference, external reference, status, type, updated since), Download PDF |
| Draft | Create, Get, Get Many (filter by external reference, updated since) |
| Counterparty | Create or Update (by NIF), Get Many |
| Vehicle | Create or Update (by plate), Get Many |
| Driver | Create or Update (by NIF), Get Many |

The API never issues documents: a draft is reviewed and issued by the office in DeCAred, or completed and issued by
the driver from the phone when the company allows it. Sending the same *External Reference* again returns the existing
draft instead of creating a duplicate. Sending that reference with different data fails with
`external_reference_conflict` (HTTP 409) and nothing is overwritten: the error names the existing draft or document so
someone can review it. To route these cases to a review branch, set the node's **On Error** setting to *Continue (using
error output)*; each failed item carries `error`, `error_code`, `http_code`, `request_id` and, for conflicts, `existing`.

**DeCAred Trigger** node

Starts a workflow when a document is issued, corrected (new version), closed or annulled, when the driver confirms
receipt, or when the driver reports the end of the service. The node subscribes and unsubscribes its webhook in
DeCAred automatically and checks the `DeCAred-Signature` header of every event.

DeCAred only delivers events to public `https://` addresses, so the trigger needs an n8n instance reachable from the
internet over HTTPS (n8n Cloud, or a self-hosted instance behind HTTPS).

## Credentials

1. Your company needs the DeCAred API, which is included in the *Documentos ilimitados + carta de porte* plan.
2. In DeCAred, go to **Más → Integraciones** and create a key. Only the *titular* or a *responsable* can do it.
   - General **read** and **write** keys cover every operation (read includes the trigger).
   - With specific permissions, give the key only what the workflow uses:

     | Node / operation | Permission |
     |---|---|
     | DeCAred Trigger | `webhooks:manage` |
     | Document (Get, Get Many, Download PDF) | `documents:read` |
     | Draft Get, Get Many / Create | `drafts:read` / `drafts:write` |
     | Counterparty, Vehicle, Driver Get Many / Create or Update | `counterparties:read`, `vehicles:read`, `drivers:read` / the matching `:write` |

     A missing permission fails with `insufficient_scope` and names the permission.
3. In n8n, create a **DeCAred API** credential and paste the key. Leave the base URL as it is.

The key is shown only once. If it leaks, revoke it in **Integraciones** and create another.

## Compatibility

Built and tested with n8n 2.44 (`n8nNodesApiVersion` 1). No runtime dependencies.

## Usage

- Use the document `id` from the trigger with **Document → Download PDF** to get the signed PDF as binary data, then
  attach it to an email or upload it to your storage.
- Delivery is at least once: if your workflow must not run twice for the same event, deduplicate by `event_id`.
- The API allows 120 requests per minute per key; above that it answers `429` with `Retry-After`.
- Error messages from DeCAred are in Spanish.

## Resources

- [DeCAred API documentation](https://decared.com/integraciones/documentacion)
- [OpenAPI specification](https://decared.com/api/v1/openapi.json)
- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)

## Version history

### 0.1.0

First release: DeCAred node (documents, drafts, counterparties, vehicles, drivers) and DeCAred Trigger.
