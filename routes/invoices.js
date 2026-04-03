const express = require('express');
const router = express.Router();
const Invoice = require('../models/Invoice');
const ServiceRequest = require('../models/ServiceRequest');
const { Transaction } = require('../models/Payment');
const auth = require('../middleware/auth');

// Helper — build invoice data from service request + transaction
async function buildInvoiceData(serviceRequest, transaction, type) {
  const pricingType = serviceRequest.pricingType || 'hourly';
  const durationUnitMap = { hourly: 'hours', daily: 'days', weekly: 'weeks', monthly: 'months', event: 'event(s)' };

  return {
    type,
    serviceRequest: serviceRequest._id,
    transaction: transaction ? transaction._id : undefined,
    client: serviceRequest.client._id || serviceRequest.client,
    provider: serviceRequest.provider._id || serviceRequest.provider,
    serviceTitle: serviceRequest.title,
    serviceType: serviceRequest.serviceType,
    description: serviceRequest.description,
    pricingType,
    duration: serviceRequest.duration,
    durationUnit: durationUnitMap[pricingType] || 'hours',
    scheduledDate: serviceRequest.scheduledDate,
    location: serviceRequest.location,
    currency: transaction ? transaction.currency : (serviceRequest.paymentCurrency || 'USD'),
    agreedRate: serviceRequest.agreedRate || serviceRequest.baseAgreedRate || 0,
    subtotal: serviceRequest.totalAmount || 0,
    adminCommission: transaction ? transaction.adminCommission : (serviceRequest.adminCommission || 0),
    providerAmount: transaction ? transaction.providerAmount : 0,
    totalAmount: serviceRequest.totalAmount || 0,
    commissionRate: 10,
    clientRating: serviceRequest.clientReview ? serviceRequest.clientReview.rating : undefined,
    clientComment: serviceRequest.clientReview ? serviceRequest.clientReview.comment : undefined,
    status: type === 'receipt' ? 'paid' : 'sent',
    paidAt: type === 'receipt' ? new Date() : undefined
  };
}

// Generate invoice/receipt/performance invoice for a service request
router.post('/generate', auth, async (req, res) => {
  try {
    const { requestId, type, performanceNotes, tasksCompleted } = req.body;
    if (!['invoice', 'receipt', 'performance'].includes(type))
      return res.status(400).json({ message: 'Invalid invoice type. Use invoice, receipt or performance.' });

    const serviceRequest = await ServiceRequest.findById(requestId)
      .populate('client', 'name email phone location')
      .populate('provider', 'name email phone location');
    if (!serviceRequest) return res.status(404).json({ message: 'Service request not found' });

    // Only client, provider or admin can generate
    const uid = req.user.userId;
    const isParty = serviceRequest.client._id.toString() === uid ||
                    serviceRequest.provider._id.toString() === uid ||
                    req.user.role === 'admin';
    if (!isParty) return res.status(403).json({ message: 'Unauthorized' });

    // Receipt requires payment to be completed
    if (type === 'receipt' && serviceRequest.paymentStatus !== 'paid')
      return res.status(400).json({ message: 'Receipt can only be generated after payment is completed.' });

    // Check if invoice of this type already exists
    const existing = await Invoice.findOne({ serviceRequest: requestId, type });
    if (existing) return res.json(existing); // return existing instead of duplicating

    const transaction = await Transaction.findOne({ serviceRequest: requestId, status: 'completed' });
    const data = await buildInvoiceData(serviceRequest, transaction, type);

    if (type === 'performance') {
      data.performanceNotes = performanceNotes || '';
      data.tasksCompleted = Array.isArray(tasksCompleted) ? tasksCompleted : [];
    }

    const invoice = new Invoice(data);
    await invoice.save();

    res.status(201).json(invoice);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get all invoices for current user
router.get('/', auth, async (req, res) => {
  try {
    const { type } = req.query;
    let query = {};
    if (req.user.role === 'client')   query.client   = req.user.userId;
    else if (req.user.role === 'provider') query.provider = req.user.userId;
    if (type) query.type = type;

    const invoices = await Invoice.find(query)
      .populate('client',  'name email')
      .populate('provider','name email')
      .populate('serviceRequest', 'title status')
      .sort({ createdAt: -1 });

    res.json(invoices);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get single invoice — returns HTML view if ?format=html
router.get('/:id', auth, async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id)
      .populate('client',  'name email phone location profileImage')
      .populate('provider','name email phone location profileImage')
      .populate('serviceRequest', 'title description status scheduledDate');

    if (!invoice) return res.status(404).json({ message: 'Invoice not found' });

    const uid = req.user.userId;
    const isParty = invoice.client._id.toString() === uid ||
                    invoice.provider._id.toString() === uid ||
                    req.user.role === 'admin';
    if (!isParty) return res.status(403).json({ message: 'Unauthorized' });

    if (req.query.format === 'html') {
      return res.send(renderInvoiceHtml(invoice));
    }

    res.json(invoice);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

function renderInvoiceHtml(inv) {
  const typeLabels = { invoice: 'INVOICE', receipt: 'RECEIPT', performance: 'PERFORMANCE INVOICE' };
  const typeColors = { invoice: '#41e4de', receipt: '#69f1c5', performance: '#f6c177' };
  const color = typeColors[inv.type] || '#41e4de';
  const label = typeLabels[inv.type] || 'INVOICE';
  const date = new Date(inv.issuedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
  const schedDate = inv.scheduledDate ? new Date(inv.scheduledDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }) : 'N/A';

  const tasksHtml = inv.tasksCompleted && inv.tasksCompleted.length
    ? `<ul style="margin:8px 0 0 18px;color:#98abc6;">${inv.tasksCompleted.map(t => `<li>${t}</li>`).join('')}</ul>`
    : '';

  const ratingHtml = inv.clientRating
    ? `<div style="margin-top:16px;padding:14px;background:rgba(105,241,197,0.08);border-radius:12px;">
        <strong style="color:#69f1c5;">Client Rating: ${'★'.repeat(inv.clientRating)}${'☆'.repeat(5 - inv.clientRating)}</strong>
        ${inv.clientComment ? `<p style="color:#98abc6;margin-top:6px;">"${inv.clientComment}"</p>` : ''}
       </div>` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${label} ${inv.invoiceNumber}</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:"Trebuchet MS","Segoe UI",sans-serif; background:#07111f; color:#ecf7ff; padding:32px 16px; }
    .card { max-width:720px; margin:auto; background:rgba(16,26,45,0.98); border:1px solid rgba(255,255,255,0.07); border-radius:24px; overflow:hidden; box-shadow:0 24px 60px rgba(0,0,0,0.5); }
    .header { padding:32px 36px; background:rgba(0,0,0,0.3); border-bottom:1px solid rgba(255,255,255,0.06); display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:16px; }
    .brand { font-size:22px; font-weight:900; letter-spacing:0.2em; color:${color}; }
    .type-badge { padding:8px 18px; border-radius:999px; background:rgba(255,255,255,0.06); border:1px solid ${color}; color:${color}; font-size:12px; font-weight:700; letter-spacing:0.2em; }
    .body { padding:32px 36px; }
    .meta { display:grid; grid-template-columns:1fr 1fr; gap:24px; margin-bottom:28px; }
    .meta-block h4 { font-size:11px; letter-spacing:0.18em; text-transform:uppercase; color:#98abc6; margin-bottom:8px; }
    .meta-block p { font-size:14px; line-height:1.7; color:#ecf7ff; }
    .meta-block p span { color:#98abc6; }
    .divider { border:none; border-top:1px solid rgba(255,255,255,0.07); margin:24px 0; }
    .line-items { width:100%; border-collapse:collapse; margin-bottom:24px; }
    .line-items th { font-size:11px; letter-spacing:0.16em; text-transform:uppercase; color:#98abc6; padding:10px 0; border-bottom:1px solid rgba(255,255,255,0.07); text-align:left; }
    .line-items td { padding:12px 0; font-size:14px; border-bottom:1px solid rgba(255,255,255,0.04); }
    .totals { margin-left:auto; width:280px; }
    .total-row { display:flex; justify-content:space-between; padding:8px 0; font-size:14px; color:#98abc6; }
    .total-row.grand { font-size:18px; font-weight:700; color:#ecf7ff; border-top:1px solid rgba(255,255,255,0.1); padding-top:14px; margin-top:6px; }
    .status-badge { display:inline-block; padding:6px 14px; border-radius:999px; font-size:12px; font-weight:700; }
    .status-paid { background:rgba(105,241,197,0.14); color:#69f1c5; }
    .status-sent { background:rgba(65,228,222,0.14); color:#41e4de; }
    .status-draft { background:rgba(255,255,255,0.08); color:#98abc6; }
    .footer { padding:20px 36px; background:rgba(0,0,0,0.2); border-top:1px solid rgba(255,255,255,0.06); text-align:center; font-size:12px; color:#98abc6; }
    .print-btn { display:block; margin:24px auto 0; padding:12px 28px; border-radius:999px; border:0; background:linear-gradient(135deg,${color},#69f1c5); color:#07111f; font-weight:700; font-size:14px; cursor:pointer; }
    @media print { .print-btn { display:none; } body { background:#fff; color:#000; } .card { box-shadow:none; border:1px solid #ddd; } }
    @media(max-width:560px) { .meta { grid-template-columns:1fr; } .header { flex-direction:column; } }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <div>
        <div class="brand">STAND-IN</div>
        <div style="color:#98abc6;font-size:13px;margin-top:4px;">Service Marketplace Platform</div>
      </div>
      <div style="text-align:right;">
        <div class="type-badge">${label}</div>
        <div style="margin-top:10px;font-size:13px;color:#98abc6;"># ${inv.invoiceNumber}</div>
        <div style="margin-top:4px;font-size:13px;color:#98abc6;">Issued: ${date}</div>
        <div style="margin-top:6px;"><span class="status-badge status-${inv.status}">${inv.status.toUpperCase()}</span></div>
      </div>
    </div>

    <div class="body">
      <div class="meta">
        <div class="meta-block">
          <h4>Bill To (Client)</h4>
          <p>${inv.client.name}<br>
          <span>${inv.client.email}</span><br>
          ${inv.client.phone ? `<span>${inv.client.phone}</span><br>` : ''}
          ${inv.client.location ? `<span>${inv.client.location}</span>` : ''}</p>
        </div>
        <div class="meta-block">
          <h4>Service Provider</h4>
          <p>${inv.provider.name}<br>
          <span>${inv.provider.email}</span><br>
          ${inv.provider.phone ? `<span>${inv.provider.phone}</span><br>` : ''}
          ${inv.provider.location ? `<span>${inv.provider.location}</span>` : ''}</p>
        </div>
        <div class="meta-block">
          <h4>Service Details</h4>
          <p>${inv.serviceTitle || 'N/A'}<br>
          <span>Type: ${inv.serviceType || 'N/A'}</span><br>
          <span>Pricing: ${inv.pricingType || 'hourly'}</span><br>
          <span>Scheduled: ${schedDate}</span></p>
        </div>
        <div class="meta-block">
          <h4>Location</h4>
          <p><span>${inv.location || 'N/A'}</span></p>
        </div>
      </div>

      <hr class="divider">

      <table class="line-items">
        <thead>
          <tr>
            <th>Description</th>
            <th>Duration</th>
            <th>Rate</th>
            <th style="text-align:right;">Amount</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>${inv.serviceTitle || inv.serviceType || 'Service'}</td>
            <td>${inv.duration || 1} ${inv.durationUnit || 'hours'}</td>
            <td>${inv.currency} ${(inv.agreedRate || 0).toFixed(2)}</td>
            <td style="text-align:right;">${inv.currency} ${(inv.subtotal || 0).toFixed(2)}</td>
          </tr>
          ${inv.description ? `<tr><td colspan="4" style="color:#98abc6;font-size:13px;padding-top:4px;">${inv.description}</td></tr>` : ''}
        </tbody>
      </table>

      <div class="totals">
        <div class="total-row"><span>Subtotal</span><span>${inv.currency} ${(inv.subtotal || 0).toFixed(2)}</span></div>
        <div class="total-row"><span>Platform Commission (${inv.commissionRate}%)</span><span>- ${inv.currency} ${(inv.adminCommission || 0).toFixed(2)}</span></div>
        <div class="total-row"><span>Provider Receives</span><span>${inv.currency} ${(inv.providerAmount || 0).toFixed(2)}</span></div>
        <div class="total-row grand"><span>TOTAL</span><span>${inv.currency} ${(inv.totalAmount || 0).toFixed(2)}</span></div>
      </div>

      ${inv.type === 'performance' ? `
      <hr class="divider">
      <div>
        <h4 style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#98abc6;margin-bottom:10px;">Performance Summary</h4>
        ${inv.performanceNotes ? `<p style="color:#ecf7ff;line-height:1.7;">${inv.performanceNotes}</p>` : ''}
        ${tasksHtml}
        ${ratingHtml}
      </div>` : ''}
    </div>

    <div class="footer">
      Thank you for using Stand-In. This document was generated automatically.
      ${inv.type === 'receipt' ? '<br><strong style="color:#69f1c5;">✓ Payment Confirmed</strong>' : ''}
    </div>
  </div>
  <button class="print-btn" onclick="window.print()">🖨️ Print / Save as PDF</button>
</body>
</html>`;
}

module.exports = router;
