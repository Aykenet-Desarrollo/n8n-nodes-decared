const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { DeCAred } = require('../dist/nodes/DeCAred/DeCAred.node');

function context(parameters, responses = []) {
	const requests = [];
	return {
		requests,
		getInputData: () => [{ json: {} }],
		getNodeParameter: (name, _i, fallback) => parameters[name] ?? fallback,
		getNode: () => ({
			name: 'DeCAred',
			type: 'deCAred',
			typeVersion: 1,
			position: [0, 0],
			parameters,
		}),
		getCredentials: async () => ({ baseUrl: 'https://example.invalid/api/v1' }),
		continueOnFail: () => false,
		helpers: {
			httpRequestWithAuthentication: async (_credential, request) => {
				requests.push(request);
				assert.ok(responses.length, 'Unexpected HTTP request');
				return responses.shift();
			},
			returnJsonArray: (data) => (Array.isArray(data) ? data : [data]).map((json) => ({ json })),
			constructExecutionMetaData: (items, { itemData }) =>
				items.map((item) => ({ ...item, pairedItem: itemData })),
			prepareBinaryData: async (buffer, fileName, mimeType) => ({
				data: buffer.toString('base64'),
				fileName,
				mimeType,
			}),
		},
	};
}
const ok = (data) => ({ statusCode: 200, body: { data }, headers: {} });
const execute = (ctx) => DeCAred.prototype.execute.call(ctx);

test('all eight actions prepare the exact proposal without a confirmation call', async () => {
	for (const action of [
		'issue',
		'correct',
		'close',
		'annul',
		'resend',
		'report_issue',
		'resolve_issue',
		'message',
	]) {
		const proposal = { action, revision: 7, body: 'Reviewed text', visibility: 'internal' };
		const ctx = context(
			{
				resource: 'workflow',
				operation: 'prepare',
				workflowDocumentId: 12,
				proposal: JSON.stringify(proposal),
			},
			[ok({ id: 'proposal', status: 'prepared' })],
		);
		const result = await execute(ctx);
		assert.equal(result[0][0].json.status, 'prepared');
		assert.equal(ctx.requests.length, 1);
		assert.equal(ctx.requests[0].url, 'https://example.invalid/api/v1/documents/12/actions');
		assert.deepEqual(ctx.requests[0].body, proposal);
		assert.deepEqual(result[0][0].pairedItem, { item: 0 });
	}
});

test('confirmation refuses missing, false or string approval without contacting the API', async () => {
	for (const approved of [undefined, false, 'true']) {
		const ctx = context({
			resource: 'workflow',
			operation: 'confirm',
			operationId: 'uuid',
			confirmationToken: 'secret',
			approved,
		});
		await assert.rejects(execute(ctx), /explicitly approve/);
		assert.equal(ctx.requests.length, 0);
	}
});

test('explicit confirmation sends only the approval and the matching token, once', async () => {
	const ctx = context(
		{
			resource: 'workflow',
			operation: 'confirm',
			operationId: 'proposal-id',
			confirmationToken: 'secret',
			approved: true,
		},
		[ok({ status: 'completed', replayed: true })],
	);
	const result = await execute(ctx);
	assert.equal(ctx.requests.length, 1);
	assert.ok(ctx.requests[0].url.endsWith('/operations/proposal-id/confirm'));
	assert.deepEqual(ctx.requests[0].body, { confirmed: true, confirmation_token: 'secret' });
	assert.equal(result[0][0].json.replayed, true);
});

test('malformed proposal JSON is refused before any request', async () => {
	for (const proposal of ['{', '[]', 'null']) {
		const ctx = context({
			resource: 'workflow',
			operation: 'prepare',
			workflowDocumentId: 1,
			proposal,
		});
		await assert.rejects(execute(ctx), /JSON/);
		assert.equal(ctx.requests.length, 0);
	}
});

test('draft update keeps the revision and native changes, including false values', async () => {
	const changes = { observations: 'Updated', driver_can_edit: false, shipments: [] };
	const ctx = context(
		{ resource: 'draft', operation: 'update', draftId: 4, revision: 9, changes },
		[ok({ revision: 10 })],
	);
	await execute(ctx);
	assert.equal(ctx.requests[0].method, 'PATCH');
	assert.deepEqual(ctx.requests[0].body, { revision: 9, data: changes });
});

test('tracking follows page metadata and preserves item pairing', async () => {
	const ctx = context(
		{
			resource: 'tracking',
			operation: 'getAll',
			trackingDocumentId: 4,
			trackingCollection: 'issues',
			returnAll: true,
		},
		[
			{ statusCode: 200, body: { data: [{ id: 1 }], meta: { last_page: 2 } } },
			{ statusCode: 200, body: { data: [{ id: 2 }], meta: { last_page: 2 } } },
		],
	);
	const result = await execute(ctx);
	assert.equal(result[0].length, 2);
	assert.deepEqual(
		ctx.requests.map((r) => r.qs.page),
		[1, 2],
	);
});

test('429 retains retry guidance and never retries a mutation', async () => {
	const ctx = context(
		{
			resource: 'workflow',
			operation: 'prepare',
			workflowDocumentId: 4,
			proposal: { action: 'issue', revision: 1 },
		},
		[
			{
				statusCode: 429,
				headers: { 'retry-after': '60' },
				body: { message: 'Límite', code: 'rate_limited', request_id: 'request' },
			},
		],
	);
	ctx.continueOnFail = () => true;
	const result = await execute(ctx);
	assert.equal(result[0][0].json.retry_after, '60');
	assert.equal(result[0][0].json.request_id, 'request');
	assert.equal(ctx.requests.length, 1);
});

test('attachment download verifies SHA-256 before exposing binary data', async () => {
	const body = Buffer.from('test attachment');
	const hash = createHash('sha256').update(body).digest('hex');
	for (const expected of [hash, 'bad', '']) {
		const ctx = context(
			{
				resource: 'attachment',
				operation: 'download',
				attachmentDocumentId: 4,
				attachmentId: 8,
				attachmentBinaryField: 'evidence',
			},
			[
				{
					statusCode: 200,
					body,
					headers: {
						'x-content-sha256': expected,
						'content-type': 'application/pdf',
						'content-disposition': 'attachment; filename="evidence.pdf"',
					},
				},
			],
		);
		if (expected === hash) {
			const result = await execute(ctx);
			assert.equal(result[0][0].binary.evidence.fileName, 'evidence.pdf');
			assert.equal(result[0][0].json.sha256, hash);
		} else {
			await assert.rejects(execute(ctx), /SHA-256/);
		}
	}
});

test('the node is not exposed as an AI tool', () => {
assert.equal(new DeCAred().description.usableAsTool, undefined);
});
