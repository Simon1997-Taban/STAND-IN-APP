const mongoose = require('mongoose');

const locationSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  serviceRequest: { type: mongoose.Schema.Types.ObjectId, ref: 'ServiceRequest' },
  
  // Location Types
  type: {
    type: String,
    enum: ['static', 'live', 'meeting_point'],
    default: 'static'
  },
  
  // GPS Coordinates
  coordinates: {
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true }
  },
  // GeoJSON for geospatial queries
  geoLocation: {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number] } // [longitude, latitude]
  },
  
  // Address Information
  address: {
    street: { type: String },
    city: { type: String },
    state: { type: String },
    country: { type: String },
    postalCode: { type: String },
    fullAddress: { type: String }
  },
  
  // Location Accuracy and Details
  accuracy: { type: Number }, // in meters
  altitude: { type: Number },
  heading: { type: Number }, // direction in degrees
  speed: { type: Number }, // in m/s
  
  // Live Location Settings
  isLiveSharing: { type: Boolean, default: false },
  liveShareStartTime: { type: Date },
  liveShareEndTime: { type: Date },
  shareWithUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  
  // Location Visibility
  isPublic: { type: Boolean, default: false },
  isSharedWithProvider: { type: Boolean, default: false },
  
  // Additional Information
  locationName: { type: String }, // e.g., "Home", "Office", "Coffee Shop"
  instructions: { type: String }, // Special instructions for finding the location
  landmarks: { type: String }, // Nearby landmarks
  
  // Expiry for temporary locations
  expiresAt: { type: Date },
  
  // Status
  isActive: { type: Boolean, default: true }
}, {
  timestamps: true
});

// Index for geospatial queries
locationSchema.index({ geoLocation: '2dsphere' });

// Index for expiring documents
locationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Method to calculate distance between two locations
locationSchema.statics.calculateDistance = function(lat1, lon1, lat2, lon2) {
  const R = 6371; // Radius of the Earth in kilometers
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  const distance = R * c; // Distance in kilometers
  return distance;
};

// Method to format location for display
locationSchema.methods.getDisplayAddress = function() {
  if (this.address.fullAddress) {
    return this.address.fullAddress;
  }
  
  const parts = [];
  if (this.address.street) parts.push(this.address.street);
  if (this.address.city) parts.push(this.address.city);
  if (this.address.state) parts.push(this.address.state);
  
  return parts.join(', ') || `${this.coordinates.latitude}, ${this.coordinates.longitude}`;
};

module.exports = mongoose.model('Location', locationSchema);