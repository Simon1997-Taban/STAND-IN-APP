# Stand-In App

A comprehensive platform connecting service providers with clients for various services including tutoring, companionship, counseling, fitness partnerships, and more.

## Features

### Core Functionality
- **User Registration & Authentication**: Separate flows for clients, service providers, and admin
- **Service Marketplace**: Browse and request services from verified providers
- **Real-time Communication**: Built-in chat system for client-provider communication
- **Request Management**: Complete workflow from request to completion
- **Payment Integration**: Commission-based payment system (10% admin fee)
- **Admin Dashboard**: Comprehensive management and analytics

### Service Categories
- 📚 Tutoring/Teaching
- 👥 Companionship (dates, events, social activities)
- 💬 Counseling/Listening
- 💪 Fitness Partner
- 👨🍳 Cooking Partner
- 🚶♂️ Walking Partner
- 💃 Dancing Partner
- 🗣️ Conversation Partner
- 🛍️ Shopping Companion
- 🎉 Event Companion

### User Roles
1. **Clients**: Request and pay for services
2. **Service Providers**: Offer services and earn money
3. **Admin**: Manage platform, users, and collect commissions

## Technology Stack

### Backend
- **Node.js** with Express.js
- **MongoDB** with Mongoose ODM
- **Socket.IO** for real-time communication
- **JWT** for authentication
- **bcryptjs** for password hashing

### Frontend
- **Vanilla JavaScript** with modern ES6+
- **Responsive CSS** with modern design
- **Socket.IO Client** for real-time features

## Installation & Setup

### Prerequisites
- Node.js (v14 or higher)
- MongoDB (local or MongoDB Atlas)
- Git

### Step 1: Clone and Install
```bash
cd "STAND IN APP/standin-app"
npm install
```

### Step 2: Environment Configuration
Update the `.env` file with your configurations:
```env
PORT=5000
MONGODB_URI=mongodb://localhost:27017/standin-app
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
NODE_ENV=development
```

### Step 3: Start MongoDB
Make sure MongoDB is running on your system:
```bash
# For local MongoDB
mongod

# Or use MongoDB Atlas cloud database
```

### Step 4: Run the Application
```bash
# Development mode with auto-restart
npm run dev

# Production mode
npm start
```

### Step 5: Access the Application
- Open your browser and go to `http://localhost:5000`
- Start with `register.html` to create accounts
- Use `login.html` to sign in
- Access dashboards based on user role

## API Endpoints

### Authentication
- `POST /api/auth/register` - User registration
- `POST /api/auth/login` - User login

### Services
- `GET /api/services/providers` - Get all service providers
- `GET /api/services/providers/:id` - Get specific provider
- `PUT /api/services/profile` - Update provider profile

### Requests
- `POST /api/requests` - Create service request
- `GET /api/requests/my-requests` - Get user's requests
- `PUT /api/requests/:id/status` - Update request status

### Admin
- `GET /api/admin/dashboard` - Admin dashboard stats
- `GET /api/admin/users` - Get all users
- `GET /api/admin/requests` - Get all requests
- `PUT /api/admin/users/:id/verify` - Verify/unverify user

## File Structure
```
standin-app/
├── models/
│   ├── User.js              # User model (clients, providers, admin)
│   └── ServiceRequest.js    # Service request model
├── routes/
│   ├── auth.js             # Authentication routes
│   ├── services.js         # Service provider routes
│   ├── requests.js         # Service request routes
│   └── admin.js            # Admin management routes
├── middleware/
│   └── auth.js             # JWT authentication middleware
├── public/
│   ├── register.html       # User registration page
│   ├── login.html          # User login page
│   ├── dashboard.html      # Client/Provider dashboard
│   ├── admin-dashboard.html # Admin dashboard
│   └── chat.html           # Real-time chat interface
├── server.js               # Main server file
├── package.json            # Dependencies and scripts
└── .env                    # Environment configuration
```

## Usage Guide

### For Clients
1. Register as a "client"
2. Browse available service providers
3. Send service requests with details
4. Chat with providers once accepted
5. Complete payment after service

### For Service Providers
1. Register as a "provider"
2. Set your services and hourly rate
3. Receive and manage service requests
4. Chat with clients
5. Receive payments (minus 10% commission)

### For Admins
1. Register with role "admin" (or modify database directly)
2. Access admin dashboard
3. Manage users and verify providers
4. Monitor all service requests
5. Track commission earnings

## Security Features
- Password hashing with bcrypt
- JWT token authentication
- Input validation and sanitization
- Protected admin routes
- Secure real-time communication

## Future Enhancements
- [ ] Payment gateway integration (Stripe/PayPal)
- [ ] Email notifications
- [ ] Mobile app development
- [ ] Advanced search and filtering
- [ ] Rating and review system
- [ ] Photo/video uploads
- [ ] Calendar integration
- [ ] Push notifications
- [ ] Multi-language support

## Contributing
1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License
This project is licensed under the MIT License.

## Support
For support and questions, please contact the development team or create an issue in the repository.