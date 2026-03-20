const express = require('express');
const User = require('../models/User');
const auth = require('../middleware/auth');
const router = express.Router();

function pickProfilePayload(user) {
  return {
    id: user._id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    location: user.location,
    bio: user.bio,
    profileImage: user.profileImage,
    services: user.services,
    hourlyRate: user.hourlyRate,
    rating: user.rating,
    totalReviews: user.totalReviews,
    isVerified: user.isVerified,
    createdAt: user.createdAt
  };
}

// Get all service providers (for clients - all providers)
router.get('/providers', async (req, res) => {
  try {
    const { serviceType, location } = req.query;
    let query = { role: 'provider', isActive: true };
    if (serviceType) query.services = { $in: [serviceType] };
    if (location) query.location = new RegExp(location, 'i');
    const providers = await User.find(query).select('-password -paymentMethods').sort({ rating: -1 });
    res.json(providers);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get own services (for logged-in provider)
router.get('/my-services', auth, async (req, res) => {
  try {
    if (req.user.role !== 'provider') return res.status(403).json({ message: 'Providers only' });
    const provider = await User.findById(req.user.userId).select('-password -paymentMethods');
    if (!provider) return res.status(404).json({ message: 'Provider not found' });
    res.json(provider);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get current user profile
router.get('/profile', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select('-password -paymentMethods');
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json(pickProfilePayload(user));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get provider by ID
router.get('/providers/:id', async (req, res) => {
  try {
    const provider = await User.findById(req.params.id)
      .select('-password -paymentMethods');
    
    if (!provider || provider.role !== 'provider') {
      return res.status(404).json({ message: 'Provider not found' });
    }
    
    res.json(provider);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Update provider/user profile
router.put('/profile', auth, async (req, res) => {
  try {
    const allowedFields = ['name', 'phone', 'location', 'bio', 'profileImage'];

    if (req.user.role === 'provider') {
      allowedFields.push('hourlyRate');
      allowedFields.push('services');
    }

    const updates = {};
    allowedFields.forEach((field) => {
      if (Object.prototype.hasOwnProperty.call(req.body, field)) {
        updates[field] = req.body[field];
      }
    });

    if (Object.prototype.hasOwnProperty.call(updates, 'profileImage') && !updates.profileImage) {
      return res.status(400).json({ message: 'Profile photo cannot be empty' });
    }

    if (Object.prototype.hasOwnProperty.call(updates, 'hourlyRate') && req.user.role === 'provider') {
      const numericRate = Number(updates.hourlyRate);
      if (!Number.isFinite(numericRate) || numericRate <= 0) {
        return res.status(400).json({ message: 'Hourly rate must be a valid number greater than 0' });
      }
      updates.hourlyRate = numericRate;
    }

    const user = await User.findById(req.user.userId).select('-password -paymentMethods');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    Object.assign(user, updates);

    if (!user.profileImage) {
      return res.status(400).json({ message: 'A profile photo is required on every account' });
    }

    await user.save();
    res.json(pickProfilePayload(user));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
