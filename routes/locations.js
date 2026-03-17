const express = require('express');
const Location = require('../models/Location');
const ServiceRequest = require('../models/ServiceRequest');
const auth = require('../middleware/auth');
const router = express.Router();

// Share current location
router.post('/share', auth, async (req, res) => {
  try {
    const { 
      latitude, 
      longitude, 
      accuracy, 
      altitude, 
      heading, 
      speed,
      address,
      serviceRequestId,
      type = 'static',
      locationName,
      instructions,
      landmarks,
      isLiveSharing = false,
      shareDuration = 60 // minutes
    } = req.body;

    // Validate coordinates
    if (!latitude || !longitude) {
      return res.status(400).json({ message: 'Latitude and longitude are required' });
    }

    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      return res.status(400).json({ message: 'Invalid coordinates' });
    }

    let shareWithUsers = [];
    let expiresAt = null;

    // If sharing for a service request, add provider to share list
    if (serviceRequestId) {
      const serviceRequest = await ServiceRequest.findById(serviceRequestId);
      if (!serviceRequest) {
        return res.status(404).json({ message: 'Service request not found' });
      }

      // Verify user is the client
      if (serviceRequest.client.toString() !== req.user.userId) {
        return res.status(403).json({ message: 'Unauthorized' });
      }

      shareWithUsers.push(serviceRequest.provider);
    }

    // Set expiry for live sharing
    if (isLiveSharing) {
      expiresAt = new Date(Date.now() + shareDuration * 60 * 1000);
    }

    const location = new Location({
      user: req.user.userId,
      serviceRequest: serviceRequestId,
      type,
      coordinates: { latitude, longitude },
      accuracy,
      altitude,
      heading,
      speed,
      address,
      locationName,
      instructions,
      landmarks,
      isLiveSharing,
      liveShareStartTime: isLiveSharing ? new Date() : null,
      liveShareEndTime: expiresAt,
      shareWithUsers,
      isSharedWithProvider: !!serviceRequestId,
      expiresAt
    });

    await location.save();
    await location.populate('shareWithUsers', 'name email');

    res.status(201).json({
      message: 'Location shared successfully',
      location,
      shareUrl: `${req.protocol}://${req.get('host')}/location-view.html?id=${location._id}`
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Update live location
router.put('/live/:id', auth, async (req, res) => {
  try {
    const { latitude, longitude, accuracy, altitude, heading, speed } = req.body;

    const location = await Location.findOne({
      _id: req.params.id,
      user: req.user.userId,
      isLiveSharing: true,
      isActive: true
    });

    if (!location) {
      return res.status(404).json({ message: 'Live location not found or expired' });
    }

    // Update coordinates and metadata
    location.coordinates = { latitude, longitude };
    if (accuracy !== undefined) location.accuracy = accuracy;
    if (altitude !== undefined) location.altitude = altitude;
    if (heading !== undefined) location.heading = heading;
    if (speed !== undefined) location.speed = speed;

    await location.save();

    // Emit real-time update via Socket.IO
    if (req.app.get('io')) {
      req.app.get('io').to(`location-${location._id}`).emit('location-update', {
        locationId: location._id,
        coordinates: location.coordinates,
        accuracy: location.accuracy,
        heading: location.heading,
        speed: location.speed,
        timestamp: new Date()
      });
    }

    res.json({ message: 'Location updated successfully', location });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get shared location
router.get('/:id', async (req, res) => {
  try {
    const location = await Location.findById(req.params.id)
      .populate('user', 'name phone')
      .populate('serviceRequest', 'title serviceType status');

    if (!location || !location.isActive) {
      return res.status(404).json({ message: 'Location not found' });
    }

    // Check if location has expired
    if (location.expiresAt && location.expiresAt < new Date()) {
      return res.status(410).json({ message: 'Location sharing has expired' });
    }

    // Check access permissions
    const hasAccess = 
      location.isPublic || 
      (req.user && location.user._id.toString() === req.user.userId) ||
      (req.user && location.shareWithUsers.includes(req.user.userId));

    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    res.json(location);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get user's shared locations
router.get('/user/my-locations', auth, async (req, res) => {
  try {
    const locations = await Location.find({
      user: req.user.userId,
      isActive: true
    })
    .populate('serviceRequest', 'title serviceType status')
    .sort({ createdAt: -1 });

    res.json(locations);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get locations shared with user (for providers)
router.get('/shared/with-me', auth, async (req, res) => {
  try {
    const locations = await Location.find({
      shareWithUsers: req.user.userId,
      isActive: true,
      $or: [
        { expiresAt: { $exists: false } },
        { expiresAt: { $gt: new Date() } }
      ]
    })
    .populate('user', 'name phone')
    .populate('serviceRequest', 'title serviceType status')
    .sort({ createdAt: -1 });

    res.json(locations);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Stop live location sharing
router.put('/stop-live/:id', auth, async (req, res) => {
  try {
    const location = await Location.findOne({
      _id: req.params.id,
      user: req.user.userId,
      isLiveSharing: true
    });

    if (!location) {
      return res.status(404).json({ message: 'Live location not found' });
    }

    location.isLiveSharing = false;
    location.liveShareEndTime = new Date();
    location.expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // Keep for 24 hours

    await location.save();

    // Notify via Socket.IO
    if (req.app.get('io')) {
      req.app.get('io').to(`location-${location._id}`).emit('location-stopped', {
        locationId: location._id,
        message: 'Live location sharing has stopped'
      });
    }

    res.json({ message: 'Live location sharing stopped', location });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Delete location
router.delete('/:id', auth, async (req, res) => {
  try {
    const location = await Location.findOne({
      _id: req.params.id,
      user: req.user.userId
    });

    if (!location) {
      return res.status(404).json({ message: 'Location not found' });
    }

    location.isActive = false;
    await location.save();

    res.json({ message: 'Location deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Find nearby providers (for clients)
router.post('/nearby-providers', auth, async (req, res) => {
  try {
    const { latitude, longitude, radius = 10, serviceType } = req.body; // radius in km

    if (!latitude || !longitude) {
      return res.status(400).json({ message: 'Latitude and longitude are required' });
    }

    // Find providers within radius
    const providers = await Location.aggregate([
      {
        $geoNear: {
          near: {
            type: 'Point',
            coordinates: [longitude, latitude]
          },
          distanceField: 'distance',
          maxDistance: radius * 1000, // Convert km to meters
          spherical: true
        }
      },
      {
        $lookup: {
          from: 'users',
          localField: 'user',
          foreignField: '_id',
          as: 'provider'
        }
      },
      {
        $unwind: '$provider'
      },
      {
        $match: {
          'provider.role': 'provider',
          'provider.isActive': true,
          ...(serviceType && { 'provider.services': serviceType })
        }
      },
      {
        $project: {
          provider: {
            _id: 1,
            name: 1,
            services: 1,
            hourlyRate: 1,
            rating: 1,
            totalReviews: 1
          },
          distance: 1,
          coordinates: 1
        }
      }
    ]);

    res.json(providers);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Reverse geocoding (get address from coordinates)
router.post('/reverse-geocode', auth, async (req, res) => {
  try {
    const { latitude, longitude } = req.body;

    if (!latitude || !longitude) {
      return res.status(400).json({ message: 'Latitude and longitude are required' });
    }

    // This is a placeholder for reverse geocoding
    // In production, you would integrate with Google Maps API, OpenStreetMap, or similar service
    const mockAddress = {
      street: '123 Main Street',
      city: 'Sample City',
      state: 'Sample State',
      country: 'Sample Country',
      postalCode: '12345',
      fullAddress: `123 Main Street, Sample City, Sample State 12345, Sample Country`
    };

    res.json({
      coordinates: { latitude, longitude },
      address: mockAddress
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;