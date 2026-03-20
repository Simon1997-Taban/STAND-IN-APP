const express = require('express');
const ServiceRequest = require('../models/ServiceRequest');
const User = require('../models/User');
const auth = require('../middleware/auth');
const {
  DEFAULT_CURRENCY,
  convertFromUsd,
  getExchangeRate,
  isSupportedCurrency,
  normalizeCurrency,
  roundMoney
} = require('../utils/currency');
const router = express.Router();

// Simple zoom-like meeting link generator
function generateMeetingLink() {
  const id = Math.random().toString(36).substring(2, 12);
  return `https://meet.jit.si/standin-${id}`;
}

function canAccessRequest(request, authUser) {
  if (!request || !authUser) {
    return false;
  }

  const isProvider = request.provider && request.provider.toString() === authUser.userId;
  const isClient = request.client && request.client.toString() === authUser.userId;
  const isAdmin = authUser.role === 'admin';

  return isProvider || isClient || isAdmin;
}

// Create service request
router.post('/', auth, async (req, res) => {
  try {
    const {
      providerId,
      serviceType,
      title,
      description,
      duration,
      scheduledDate,
      location,
      clientLocation,
      isOnline,
      paymentMethodId,
      paymentCurrency
    } = req.body;

    if (req.user.role !== 'client') {
      return res.status(403).json({ message: 'Only clients can place service requests' });
    }

    if (!providerId || !title || !description || !duration)
      return res.status(400).json({ message: 'providerId, title, description and duration are required' });

    if (!paymentMethodId)
      return res.status(400).json({ message: 'Please add a payment method before placing a request.' });

    if (!isOnline && !clientLocation && !location)
      return res.status(400).json({ message: 'Please share your location for in-person services.' });

    const provider = await User.findById(providerId);
    if (!provider || provider.role !== 'provider')
      return res.status(404).json({ message: 'Provider not found' });

    if (!provider.hourlyRate || !duration)
      return res.status(400).json({ message: 'Invalid rate or duration' });

    const selectedCurrency = isSupportedCurrency(paymentCurrency)
      ? normalizeCurrency(paymentCurrency)
      : DEFAULT_CURRENCY;
    const exchangeRate = getExchangeRate(selectedCurrency);
    const baseAgreedRate = roundMoney(provider.hourlyRate);
    const baseTotalAmount = roundMoney(baseAgreedRate * Number(duration));
    const baseAdminCommission = roundMoney(baseTotalAmount * 0.15);
    const agreedRate = convertFromUsd(baseAgreedRate, selectedCurrency);
    const totalAmount = convertFromUsd(baseTotalAmount, selectedCurrency);
    const adminCommission = convertFromUsd(baseAdminCommission, selectedCurrency);

    const request = new ServiceRequest({
      client: req.user.userId,
      provider: providerId,
      serviceType,
      title,
      description,
      duration,
      scheduledDate,
      location,
      clientLocation,
      isOnline,
      zoomLink: isOnline ? generateMeetingLink() : undefined,
      baseCurrency: DEFAULT_CURRENCY,
      paymentCurrency: selectedCurrency,
      exchangeRate,
      baseAgreedRate,
      baseTotalAmount,
      baseAdminCommission,
      agreedRate,
      totalAmount,
      adminCommission,
      chatRoom: `${req.user.userId}_${providerId}_${Date.now()}`
    });

    await request.save();
    await request.populate([
      { path: 'client', select: 'name email phone profileImage role' },
      { path: 'provider', select: 'name email phone profileImage services rating role' }
    ]);
    res.status(201).json(request);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get user's requests
router.get('/my-requests', auth, async (req, res) => {
  try {
    let query = {};
    if (req.user.role === 'client') query.client = req.user.userId;
    else if (req.user.role === 'provider') query.provider = req.user.userId;

    const requests = await ServiceRequest.find(query)
      .populate('client', 'name email phone profileImage role')
      .populate('provider', 'name email phone profileImage services rating role')
      .sort({ createdAt: -1 });
    res.json(requests);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Load chat room details and message history
router.get('/chat/:roomId', auth, async (req, res) => {
  try {
    const request = await ServiceRequest.findOne({ chatRoom: req.params.roomId })
      .populate('client', 'name profileImage role')
      .populate('provider', 'name profileImage role');

    if (!request) {
      return res.status(404).json({ message: 'Chat room not found' });
    }

    if (!canAccessRequest(request, req.user)) {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    res.json({
      requestId: request._id,
      roomId: request.chatRoom,
      title: request.title,
      status: request.status,
      participants: {
        client: request.client,
        provider: request.provider
      },
      messages: request.chatMessages || []
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Save chat messages so both sides can always see them
router.post('/chat/:roomId/messages', auth, async (req, res) => {
  try {
    const message = String(req.body.message || '').trim();

    if (!message) {
      return res.status(400).json({ message: 'Message cannot be empty' });
    }

    const request = await ServiceRequest.findOne({ chatRoom: req.params.roomId });
    if (!request) {
      return res.status(404).json({ message: 'Chat room not found' });
    }

    if (!canAccessRequest(request, req.user)) {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    const sender = await User.findById(req.user.userId).select('name role profileImage');
    if (!sender) {
      return res.status(404).json({ message: 'User not found' });
    }

    request.chatMessages.push({
      sender: sender._id,
      userName: sender.name,
      userRole: sender.role,
      userImage: sender.profileImage,
      message,
      timestamp: new Date()
    });

    await request.save();

    const savedMessage = request.chatMessages[request.chatMessages.length - 1];
    const payload = {
      _id: savedMessage._id,
      roomId: request.chatRoom,
      userId: String(sender._id),
      userName: sender.name,
      userRole: sender.role,
      userImage: sender.profileImage,
      message: savedMessage.message,
      timestamp: savedMessage.timestamp
    };

    const io = req.app.get('io');
    if (io) {
      io.to(request.chatRoom).emit('receive-message', payload);
    }

    res.status(201).json(payload);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Update request status
router.put('/:id/status', auth, async (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ['pending', 'accepted', 'rejected', 'in-progress', 'completed', 'cancelled'];
    if (!validStatuses.includes(status))
      return res.status(400).json({ message: 'Invalid status value' });

    const request = await ServiceRequest.findById(req.params.id);
    if (!request) return res.status(404).json({ message: 'Request not found' });

    const isProvider = req.user.role === 'provider' && request.provider.toString() === req.user.userId;
    const isClient = req.user.role === 'client' && request.client.toString() === req.user.userId;
    const isAdmin = req.user.role === 'admin';

    if (!isProvider && !isClient && !isAdmin)
      return res.status(403).json({ message: 'Unauthorized' });

    request.status = status;
    await request.save();
    res.json(request);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Submit rating after completion
router.post('/:id/rate', auth, async (req, res) => {
  try {
    const { rating, comment } = req.body;
    if (!rating || rating < 1 || rating > 5)
      return res.status(400).json({ message: 'Rating must be between 1 and 5' });

    const request = await ServiceRequest.findById(req.params.id);
    if (!request) return res.status(404).json({ message: 'Request not found' });
    if (request.status !== 'completed') return res.status(400).json({ message: 'Can only rate completed services' });
    if (request.client.toString() !== req.user.userId) return res.status(403).json({ message: 'Unauthorized' });
    if (request.clientReview && request.clientReview.rating) return res.status(400).json({ message: 'Already rated' });

    request.clientReview = { rating: Number(rating), comment: comment || '' };
    await request.save();

    const provider = await User.findById(request.provider);
    if (provider) {
      const newTotal = provider.totalReviews + 1;
      provider.rating = ((provider.rating * provider.totalReviews) + Number(rating)) / newTotal;
      provider.totalReviews = newTotal;
      await provider.save();
    }

    res.json({ message: 'Rating submitted' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Share post-event photos between the client and provider
router.post('/:id/event-posts', auth, async (req, res) => {
  try {
    const request = await ServiceRequest.findById(req.params.id);
    if (!request) {
      return res.status(404).json({ message: 'Request not found' });
    }

    if (!canAccessRequest(request, req.user)) {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    if (request.status !== 'completed') {
      return res.status(400).json({ message: 'Event photo posts can only be added after the request is completed' });
    }

    const caption = String(req.body.caption || '').trim();
    const photos = Array.isArray(req.body.photos)
      ? req.body.photos.filter((photo) => typeof photo === 'string' && photo.startsWith('data:image/')).slice(0, 6)
      : [];

    if (!caption && !photos.length) {
      return res.status(400).json({ message: 'Add a caption or at least one event photo before posting' });
    }

    const author = await User.findById(req.user.userId).select('name role profileImage');
    if (!author) {
      return res.status(404).json({ message: 'User not found' });
    }

    request.eventPosts.push({
      author: author._id,
      authorName: author.name,
      authorRole: author.role,
      authorImage: author.profileImage,
      caption,
      photos
    });

    await request.save();
    res.status(201).json(request.eventPosts[request.eventPosts.length - 1]);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
