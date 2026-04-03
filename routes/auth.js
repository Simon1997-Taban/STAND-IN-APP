const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { Resend } = require('resend');
const rateLimit = require('express-rate-limit');
const User = require('../models/User');
const { getCurrencyForCountry } = require('../utils/currency');
const router = express.Router();

const resend = new Resend(process.env.RESEND_API_KEY);

if (!process.env.JWT_SECRET) {
  console.error('FATAL: JWT_SECRET is not set in .env');
  process.exit(1);
}

// Rate limiters
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 20,
  message: { message: 'Too many attempts. Please wait 15 minutes and try again.' },
  standardHeaders: true,
  legacyHeaders: false
});

const otpLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 min
  max: 5,
  message: { message: 'Too many OTP attempts. Please wait 10 minutes.' },
  standardHeaders: true,
  legacyHeaders: false
});

function generateOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function sendOtpEmail(email, name, otp) {
  await resend.emails.send({
    from: 'Stand-In App <onboarding@resend.dev>',
    to: email,
    subject: 'Verify your Stand-In account',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:auto;padding:32px;background:#07111f;color:#ecf7ff;border-radius:16px;">
        <h2 style="color:#41e4de;margin-bottom:8px;">Welcome to Stand-In, ${name}!</h2>
        <p style="color:#98abc6;margin-bottom:24px;">Use the code below to verify your email. It expires in <strong>10 minutes</strong>.</p>
        <div style="font-size:36px;font-weight:700;letter-spacing:12px;text-align:center;padding:20px;background:rgba(65,228,222,0.1);border-radius:12px;color:#41e4de;">${otp}</div>
        <p style="color:#98abc6;margin-top:24px;font-size:13px;">If you did not create a Stand-In account, ignore this email.</p>
      </div>
    `
  });
}

// SMS via email-to-SMS gateway (works without Twilio).
// To upgrade to real SMS: replace this function body with a Twilio API call.
async function sendOtpSms(phone, otp) {
  // Normalise: strip spaces/dashes, ensure + prefix
  const normalised = phone.replace(/[\s\-()]/g, '');

  // If TWILIO_ACCOUNT_SID is configured, use Twilio
  if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_PHONE) {
    const twilio = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    await twilio.messages.create({
      body: `Your Stand-In verification code is: ${otp}. Expires in 10 minutes.`,
      from: process.env.TWILIO_PHONE,
      to: normalised
    });
    return;
  }

  // No Twilio configured — log OTP to console for development
  console.warn(`[DEV] SMS OTP for ${normalised}: ${otp} (configure Twilio in .env for real SMS)`);
  // In production without Twilio, throw so caller knows SMS failed
  if (process.env.NODE_ENV === 'production') {
    throw new Error('SMS service not configured. Please use email verification.');
  }
}

// Admin count check (used by register form)
router.get('/admin-count', async (req, res) => {
  try {
    const count = await User.countDocuments({ role: 'admin' });
    res.json({ count });
  } catch (error) {
    res.status(500).json({ message: 'Could not check admin count.' });
  }
});

// Register — saves user unverified, sends OTP
router.post('/register', authLimiter, async (req, res) => {
  try {
    const { name, email, password, phone, role, services, hourlyRate, location, country, bio, profileImage, verifyMethod } = req.body;

    if (!name || !email || !password || !phone || !role || !profileImage)
      return res.status(400).json({ message: 'Name, email, password, phone, role, and profile photo are required' });

    if (!['client', 'provider', 'admin'].includes(role))
      return res.status(400).json({ message: 'Invalid role' });

    if (password.length < 8)
      return res.status(400).json({ message: 'Password must be at least 8 characters' });

    if (profileImage.length > 7 * 1024 * 1024)
      return res.status(400).json({ message: 'Profile photo must be under 5MB' });

    const method = verifyMethod === 'phone' ? 'phone' : 'email';

    if (role === 'admin') {
      const adminCount = await User.countDocuments({ role: 'admin' });
      if (adminCount >= 1)
        return res.status(400).json({ message: 'Admin registration is closed. Only one admin is allowed.' });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser)
      return res.status(400).json({ message: 'An account with this email already exists' });

    const preferredCurrency = getCurrencyForCountry(country);
    const otp = generateOtp();
    const otpHash = await bcrypt.hash(otp, 10);
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000);

    const user = new User({
      name: name.trim(), email: normalizedEmail, password,
      phone: phone.trim(), role, location,
      country: country || 'UG', preferredCurrency, bio, profileImage,
      services: role === 'provider' ? services : undefined,
      hourlyRate: role === 'provider' ? hourlyRate : undefined,
      otp: otpHash, otpExpires,
      emailVerified: false, isActive: false
    });

    await user.save();

    // Respond immediately — don't wait for email to avoid timeout
    res.status(201).json({
      message: 'Account created. Check your email for a 6-digit verification code.',
      userId: user._id,
      verifyMethod: method
    });

    // Send OTP in background after response is sent
    sendOtpEmail(normalizedEmail, name.trim(), otp).catch(err =>
      console.error('OTP send error:', JSON.stringify(err))
    );
    console.log(`[OTP] Code ${otp} generated for ${normalizedEmail}`);
  } catch (error) {
    res.status(500).json({ message: 'Registration failed. Please try again.' });
  }
});

// Verify OTP
router.post('/verify-otp', otpLimiter, async (req, res) => {
  try {
    const { userId, otp } = req.body;
    if (!userId || !otp)
      return res.status(400).json({ message: 'userId and otp are required' });

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'User not found' });
    if (user.emailVerified) return res.status(400).json({ message: 'Account already verified' });
    if (!user.otp || user.otpExpires < new Date())
      return res.status(400).json({ message: 'Verification code has expired. Please request a new one.' });

    const valid = await bcrypt.compare(otp.trim(), user.otp);
    if (!valid) return res.status(400).json({ message: 'Incorrect verification code' });

    user.emailVerified = true;
    user.isActive = true;
    user.otp = undefined;
    user.otpExpires = undefined;
    await user.save();

    const token = jwt.sign(
      { userId: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      message: 'Email verified successfully!',
      token,
      user: {
        id: user._id, name: user.name, email: user.email,
        phone: user.phone, role: user.role, location: user.location,
        country: user.country, preferredCurrency: user.preferredCurrency,
        bio: user.bio, profileImage: user.profileImage
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Verification failed. Please try again.' });
  }
});

// Resend OTP by email — for users who closed the tab before verifying
router.post('/resend-otp-by-email', otpLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: 'Email is required' });
    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) return res.status(404).json({ message: 'No account found with that email.' });
    if (user.emailVerified) return res.status(400).json({ message: 'This account is already verified. Please log in.' });

    const otp = generateOtp();
    user.otp = await bcrypt.hash(otp, 10);
    user.otpExpires = new Date(Date.now() + 10 * 60 * 1000);
    await user.save();
    res.json({ message: 'Verification code sent.', userId: user._id });
    sendOtpEmail(user.email, user.name, otp).catch(err => console.error('OTP send error:', err.message));
  } catch (error) {
    res.status(500).json({ message: 'Could not send code. Please try again.' });
  }
});

// Resend OTP
router.post('/resend-otp', otpLimiter, async (req, res) => {
  try {
    const { userId, verifyMethod } = req.body;
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'User not found' });
    if (user.emailVerified) return res.status(400).json({ message: 'Account already verified' });

    const otp = generateOtp();
    user.otp = await bcrypt.hash(otp, 10);
    user.otpExpires = new Date(Date.now() + 10 * 60 * 1000);
    await user.save();
    if (method === 'phone') {
      res.json({ message: 'A new code has been sent to your phone number.' });
      sendOtpSms(user.phone, otp).catch(err => console.error('SMS error:', err.message));
    } else {
      res.json({ message: 'A new verification code has been sent to your email.' });
      sendOtpEmail(user.email, user.name, otp).catch(err => console.error('OTP send error:', err.message));
    }
  } catch (error) {
    res.status(500).json({ message: 'Could not resend code. Please try again.' });
  }
});

// Login
router.post('/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ message: 'Email and password are required' });

    const user = await User.findOne({ email: email.toLowerCase().trim() });
    // Constant-time: always compare even if user not found
    const dummyHash = '$2a$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ012345';
    const passwordMatch = user ? await user.comparePassword(password) : await bcrypt.compare(password, dummyHash);

    if (!user || !passwordMatch)
      return res.status(401).json({ message: 'Invalid email or password' });

    if (!user.emailVerified)
      return res.status(403).json({ message: 'Please verify your email before logging in.', userId: user._id, needsVerification: true });

    if (!user.isActive)
      return res.status(403).json({ message: 'Your account has been deactivated. Contact support.' });

    const token = jwt.sign(
      { userId: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      token,
      user: {
        id: user._id, name: user.name, email: user.email,
        phone: user.phone, role: user.role, location: user.location,
        country: user.country, preferredCurrency: user.preferredCurrency,
        bio: user.bio, profileImage: user.profileImage
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Login failed. Please try again.' });
  }
});

module.exports = router;
