let currentUser = null;
let socket = null;
let capturedLocation = null;
let liveLocationInterval = null;
let allServices = [];
let currentDashboardTab = 'overview';
let profileImageData = '';
let eventPostPhotos = [];

const tabMeta = {
    services: {
        title: 'Service workspace',
        copy: 'Review providers in a focused tab, inspect profiles, and decide who deserves the booking.'
    },
    requests: {
        title: 'Request workspace',
        copy: 'Keep the request pipeline isolated so status changes, chat, and payments are easier to follow.'
    },
    payments: {
        title: 'Payment workspace',
        copy: 'Check value, pending items, and transaction history without the rest of the dashboard crowding the view.'
    },
    invoices: {
        title: 'Invoice workspace',
        copy: 'View and print invoices, receipts and performance invoices for all your completed services.'
    },
    location: {
        title: 'Location workspace',
        copy: 'Open a dedicated location tab whenever you need address visibility or live sharing details.'
    },
    profile: {
        title: 'Profile workspace',
        copy: 'Tune your public-facing profile in its own quiet space so the presentation feels deliberate and premium.'
    }
};

document.addEventListener('DOMContentLoaded', function () {
    checkAuth();
    initializeSocket();
    initializeProfilePhotoInput();
    initializeEventPostInput();
    showDashboardTab('overview', false);
    loadDashboard();
});

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, function (char) {
        return {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        }[char];
    });
}

function capitalizeWords(value) {
    return String(value || '')
        .replace(/-/g, ' ')
        .replace(/\b\w/g, function (char) {
            return char.toUpperCase();
        });
}

function formatMoney(value, currency = 'USD') {
    const normalizedCurrency = String(currency || 'USD').toUpperCase();
    const numericValue = Number(value || 0);

    try {
        return new Intl.NumberFormat(undefined, {
            style: 'currency',
            currency: normalizedCurrency,
            maximumFractionDigits: normalizedCurrency === 'UGX' || normalizedCurrency === 'RWF' || normalizedCurrency === 'BIF' || normalizedCurrency === 'SSP' ? 0 : 2
        }).format(numericValue);
    } catch (error) {
        return normalizedCurrency + ' ' + numericValue.toFixed(2);
    }
}

function formatDate(value) {
    return new Date(value).toLocaleDateString();
}

function formatDateTime(value) {
    return new Date(value).toLocaleString();
}

function getInitials(name) {
    return String(name || '?')
        .split(' ')
        .filter(Boolean)
        .slice(0, 2)
        .map(function (part) {
            return part.charAt(0).toUpperCase();
        })
        .join('') || '?';
}

function getAvatarMarkup(name, image, extraClasses) {
    if (image) {
        return `<div class="avatar-circle ${extraClasses || ''}"><img class="avatar-image" src="${escapeHtml(image)}" alt="${escapeHtml(name || 'User')}"></div>`;
    }

    return `<div class="avatar-circle ${extraClasses || ''}">${escapeHtml(getInitials(name))}</div>`;
}

function setUserAvatar(elementId, user) {
    const avatar = document.getElementById(elementId);
    if (!avatar) {
        return;
    }

    if (user && user.profileImage) {
        avatar.innerHTML = `<img class="avatar-image" src="${user.profileImage}" alt="${escapeHtml(user.name || 'User')}">`;
    } else {
        avatar.textContent = getInitials(user && user.name);
    }
}

function readFileAsDataUrl(file) {
    return new Promise(function (resolve, reject) {
        const reader = new FileReader();
        reader.onload = function () {
            resolve(reader.result);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

function setProfilePhotoPreview(image) {
    const preview = document.getElementById('profilePhotoPreview');
    if (!preview) {
        return;
    }

    if (image) {
        preview.innerHTML = `<img class="avatar-image" src="${image}" alt="Profile photo">`;
    } else {
        preview.textContent = 'Profile photo required';
    }
}

function normalizeRequestCurrency(request) {
    return request.paymentCurrency || request.currency || 'USD';
}

function checkAuth() {
    const token = localStorage.getItem('token');
    const user = localStorage.getItem('user');

    if (!token || !user) {
        window.location.href = 'login.html';
        return;
    }

    try {
        currentUser = JSON.parse(user);
    } catch (error) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        window.location.href = 'login.html';
        return;
    }

    document.getElementById('userName').textContent = currentUser.name;
    document.getElementById('userRole').textContent = currentUser.role;
    setUserAvatar('userAvatar', currentUser);

    if (currentUser.role === 'provider') {
        document.getElementById('servicesTab').textContent = 'My Services';
        document.getElementById('servicesTitle').textContent = 'Your service profile';
        document.getElementById('servicesSubtitle').textContent = 'Preview the profile and service package your clients will evaluate before they book.';
        document.getElementById('welcomeHeading').textContent = 'Run your provider business from one polished workspace.';
        document.getElementById('welcomeText').textContent = 'Open only the tab you need, keep the rest softened in the background, and present your services in a way that sells confidence.';
        document.getElementById('focusMetricCopy').textContent = 'Stay on top of active client work, payments, and the profile details that help convert more demand.';
        document.getElementById('requestsCopy').textContent = 'Accept, start, complete, and chat on active bookings directly from a focused request tab.';
        document.getElementById('earningsCard').style.display = 'block';
        document.getElementById('providerFields').style.display = 'flex';
        document.getElementById('heroPrimaryAction').textContent = 'Review requests';
        document.getElementById('heroPrimaryAction').onclick = function () { showDashboardTab('requests'); };
        document.getElementById('heroSecondaryAction').textContent = 'Edit profile';
        document.getElementById('heroSecondaryAction').onclick = function () { showDashboardTab('profile'); };
    } else {
        document.getElementById('welcomeHeading').textContent = 'Book trusted providers from a more elegant marketplace view.';
        document.getElementById('welcomeText').textContent = 'Open a clean service tab, inspect provider details first, then book with more confidence.';
        document.getElementById('heroPrimaryAction').textContent = 'Explore services';
        document.getElementById('heroPrimaryAction').onclick = function () { showDashboardTab('services'); };
        document.getElementById('heroSecondaryAction').textContent = 'Track requests';
        document.getElementById('heroSecondaryAction').onclick = function () { showDashboardTab('requests'); };
    }
}

function initializeProfilePhotoInput() {
    const input = document.getElementById('profileImageInput');

    if (!input) {
        return;
    }

    input.addEventListener('change', async function (event) {
        const file = event.target.files && event.target.files[0];
        if (!file) {
            return;
        }

        if (file.size > 3 * 1024 * 1024) {
            alert('Please choose a profile photo smaller than 3MB.');
            input.value = '';
            return;
        }

        try {
            profileImageData = await readFileAsDataUrl(file);
            setProfilePhotoPreview(profileImageData);
        } catch (error) {
            alert('Could not read that image file. Please try another one.');
        }
    });
}

function initializeEventPostInput() {
    const input = document.getElementById('eventPhotos');

    if (!input) {
        return;
    }

    input.addEventListener('change', async function (event) {
        const files = Array.from(event.target.files || []).slice(0, 6);

        try {
            eventPostPhotos = await Promise.all(files.map(async function (file) {
                if (file.size > 3 * 1024 * 1024) {
                    throw new Error('Each event photo must be smaller than 3MB.');
                }

                return readFileAsDataUrl(file);
            }));
            renderEventPhotoPreview();
        } catch (error) {
            eventPostPhotos = [];
            input.value = '';
            renderEventPhotoPreview();
            alert(error.message || 'Could not read the selected event photos.');
        }
    });
}

function initializeSocket() {
    if (typeof io === 'function') {
        socket = io();
    }
}

function showDashboardTab(tabName, shouldScroll = true) {
    currentDashboardTab = tabName;
    const shell = document.getElementById('dashboardShell');
    const stage = document.getElementById('tabStage');

    document.querySelectorAll('.nav-tab').forEach(function (button) {
        button.classList.toggle('active', button.dataset.tab === tabName);
    });

    if (tabName === 'overview') {
        shell.classList.remove('is-focus-mode');
        stage.classList.add('is-hidden');
        document.querySelectorAll('.tab-panel').forEach(function (panel) {
            panel.classList.remove('active');
        });
        if (shouldScroll) {
            document.getElementById('overview').scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        return;
    }

    shell.classList.add('is-focus-mode');
    stage.classList.remove('is-hidden');
    document.querySelectorAll('.tab-panel').forEach(function (panel) {
        panel.classList.toggle('active', panel.id === `${tabName}Panel`);
    });

    document.getElementById('activeTabTitle').textContent = tabMeta[tabName].title;
    document.getElementById('activeTabCopy').textContent = tabMeta[tabName].copy;

    if (shouldScroll) {
        stage.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

async function loadDashboard() {
    await Promise.all([
        loadStats(),
        loadServices(),
        loadRequests(),
        loadProfile(),
        loadTransactions(),
        loadLocations(),
        loadInvoices()
    ]);
}

async function loadStats() {
    try {
        const res = await fetch('/api/requests/my-requests', {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
        });

        if (!res.ok) return;
        const data = await res.json();
        const requests = data.requests || data; // handle paginated response
        const activeCount = requests.filter(function (r) {
            return ['pending', 'accepted', 'in-progress'].includes(r.status);
        }).length;
        const completedCount = requests.filter(function (r) {
            return r.status === 'completed';
        }).length;

        document.getElementById('totalRequests').textContent = requests.length;
        document.getElementById('activeRequests').textContent = activeCount;
        document.getElementById('completedRequests').textContent = completedCount;
        document.getElementById('focusMetric').textContent = activeCount + ' active requests';

        if (currentUser.role === 'provider') {
            const earnings = requests
                .filter(function (r) { return r.status === 'completed' && r.paymentStatus === 'paid'; })
                .reduce(function (sum, r) {
                    return sum + ((r.baseTotalAmount || r.totalAmount || 0) - (r.baseAdminCommission || r.adminCommission || 0));
                }, 0);
            document.getElementById('totalEarnings').textContent = formatMoney(earnings);
        }
    } catch (error) {
        console.error(error);
    }
}

async function loadServices() {
    try {
        const url = currentUser.role === 'provider' ? '/api/services/my-services' : '/api/services/providers';
        const headers = currentUser.role === 'provider'
            ? { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
            : {};

        const res = await fetch(url, { headers: headers });

        if (!res.ok) {
            allServices = [];
            displayServices([]);
            return;
        }

        const data = await res.json();
        allServices = Array.isArray(data) ? data : [data];
        filterServices();
    } catch (error) {
        console.error(error);
    }
}

function filterServices() {
    const filter = document.getElementById('serviceFilter').value;

    if (currentUser.role === 'provider') {
        displayServices(allServices);
        return;
    }

    const filteredServices = filter
        ? allServices.filter(function (provider) {
            return Array.isArray(provider.services) && provider.services.includes(filter);
        })
        : allServices;

    displayServices(filteredServices);
}

function displayServices(providers) {
    const grid = document.getElementById('servicesGrid');
    const hasProvider = providers.length && providers[0] && providers[0]._id;

    if (!providers.length || !hasProvider) {
        grid.innerHTML = '<div class="empty-state"><h3>No services available</h3><p>Add provider details or adjust your filters to see available offers.</p></div>';
        return;
    }

    grid.innerHTML = providers.map(function (provider) {
        const services = Array.isArray(provider.services) && provider.services.length ? provider.services : ['general'];
        const verifiedBadge = provider.isVerified ? '<span class="surface-tag">Verified provider</span>' : '<span class="surface-tag">Provider profile</span>';
        const pricingType = provider.pricingType || 'hourly';
        const rate = provider.rates && provider.rates[pricingType] ? provider.rates[pricingType] : (provider.hourlyRate || 0);
        const rateLabel = { hourly:'/ hr', daily:'/ day', weekly:'/ week', monthly:'/ month', event:'/ event' }[pricingType] || '/ hr';

        return `
            <article class="service-card">
                <div class="service-card-head">
                    ${verifiedBadge}
                    <strong>${formatMoney(rate, 'USD')} ${rateLabel}</strong>
                </div>
                <div class="service-owner">
                    ${getAvatarMarkup(provider.name, provider.profileImage, '')}
                    <div class="service-owner-meta">
                        <span>${currentUser.role === 'provider' ? 'Public profile preview' : 'Available provider'}</span>
                        <h4>${escapeHtml(provider.name || 'Stand-In Provider')}</h4>
                    </div>
                </div>
                <p>${escapeHtml(provider.bio || 'Professional service provider ready to deliver a polished experience.')}</p>
                <div class="service-list">
                    ${services.map(function (service) {
                        return `<span class="service-chip">${escapeHtml(capitalizeWords(service))}</span>`;
                    }).join('')}
                </div>
                <div class="meta-copy">
                    <span>Location: ${escapeHtml(provider.location || 'Not specified')}</span>
                    <span>Rating: ${Number(provider.rating || 0).toFixed(1)} / 5</span>
                    <span>Reviews: ${provider.totalReviews || 0}</span>
                </div>
                <div class="service-footer">
                    <span class="rating-pill">${currentUser.role === 'provider' ? 'Preview how clients see you' : 'Open full profile before booking'}</span>
                    ${currentUser.role === 'client'
                        ? `
                            <div class="panel-actions">
                                <button class="btn-secondary" onclick="openProviderProfile('${provider._id}')">View profile</button>
                                <button class="btn" onclick="requestService('${provider._id}')">Book now</button>
                            </div>
                        `
                        : `<button class="btn-secondary" onclick="showDashboardTab('profile')">Edit profile</button>`}
                </div>
            </article>
        `;
    }).join('');
}

async function openProviderProfile(providerId) {
    try {
        const res = await fetch(`/api/services/providers/${providerId}`);
        if (!res.ok) {
            alert('Could not load provider profile.');
            return;
        }

        const provider = await res.json();
        const services = Array.isArray(provider.services) && provider.services.length ? provider.services : ['general'];
        const memberSince = provider.createdAt ? new Date(provider.createdAt).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) : 'Recently joined';
        document.getElementById('providerProfileContent').innerHTML = `
            <div class="provider-profile-shell">
                <div class="provider-profile-hero">
                    <div class="provider-profile-panel">
                        <p class="eyebrow">Provider profile</p>
                        <div class="service-owner">
                            ${getAvatarMarkup(provider.name, provider.profileImage, '')}
                            <div class="service-owner-meta">
                                <span>Trusted profile</span>
                                <h3>${escapeHtml(provider.name || 'Stand-In Provider')}</h3>
                            </div>
                        </div>
                        <p class="card-copy">${escapeHtml(provider.bio || 'This provider has not added a longer bio yet, but the service categories and rate below are ready for review.')}</p>
                        <div class="service-list">
                            ${services.map(function (service) {
                                return `<span class="service-chip">${escapeHtml(capitalizeWords(service))}</span>`;
                            }).join('')}
                        </div>
                        <div class="panel-actions">
                            <button type="button" class="btn" onclick="requestService('${provider._id}', true)">Book this provider</button>
                            <button type="button" class="btn-secondary" onclick="closeProviderModal()">Keep browsing</button>
                        </div>
                    </div>
                    <div class="provider-profile-panel">
                        <div class="provider-kpis">
                            <div class="provider-kpi">
                                <span>Hourly rate</span>
                                <strong>${formatMoney(provider.hourlyRate, provider.hourlyRateCurrency || 'USD')}</strong>
                            </div>
                            <div class="provider-kpi">
                                <span>Rating</span>
                                <strong>${Number(provider.rating || 0).toFixed(1)} / 5</strong>
                            </div>
                            <div class="provider-kpi">
                                <span>Reviews</span>
                                <strong>${provider.totalReviews || 0}</strong>
                            </div>
                            <div class="provider-kpi">
                                <span>Status</span>
                                <strong>${provider.isVerified ? 'Verified' : 'Pending verification'}</strong>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="provider-detail-grid">
                    <div class="provider-detail-card">
                        <span>Location</span>
                        <strong>${escapeHtml(provider.location || 'Location not set')}</strong>
                    </div>
                    <div class="provider-detail-card">
                        <span>Contact</span>
                        <strong>${escapeHtml(provider.phone || 'Phone not public')}</strong>
                    </div>
                    <div class="provider-detail-card">
                        <span>Membership</span>
                        <strong>${escapeHtml(memberSince)}</strong>
                    </div>
                    <div class="provider-detail-card">
                        <span>Profile strength</span>
                        <strong>${services.length} service categories listed for clients to review</strong>
                    </div>
                </div>
            </div>
        `;
        document.getElementById('providerProfileModal').style.display = 'block';
    } catch (error) {
        alert('Network error. Please try again.');
    }
}

function closeProviderModal() {
    document.getElementById('providerProfileModal').style.display = 'none';
}

async function loadRequests() {
    try {
        const res = await fetch('/api/requests/my-requests', {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
        });

        if (res.ok) {
            const data = await res.json();
            displayRequests(data.requests || data);
        }
    } catch (error) {
        console.error(error);
    }
}

function statusTracker(status) {
    const steps = ['pending', 'accepted', 'in-progress', 'completed'];
    return `<div class="tracker">${steps.map(function (step, index) {
        const stepClass = step === status ? 'active' : steps.indexOf(status) > index ? 'done' : '';
        return `<span class="tracker-step ${stepClass}">${capitalizeWords(step)}</span>`;
    }).join('')}</div>`;
}

function displayRequests(requests) {
    const list = document.getElementById('requestsList');

    if (!requests.length) {
        list.innerHTML = '<div class="empty-state"><h3>No requests yet</h3><p>Start by browsing services and sending your first premium service request.</p></div>';
        return;
    }

    list.innerHTML = requests.map(function (request) {
        const partnerName = currentUser.role === 'client'
            ? (request.provider && request.provider.name) || 'Provider'
            : (request.client && request.client.name) || 'Client';
        const requestCurrency = normalizeRequestCurrency(request);
        const eventPosts = Array.isArray(request.eventPosts) ? request.eventPosts : [];

        return `
            <article class="request-card">
                <div class="request-top">
                    <div>
                        <h4>${escapeHtml(request.title)}</h4>
                        <div class="request-meta">
                            <span>${currentUser.role === 'client' ? 'Provider' : 'Client'}: ${escapeHtml(partnerName)}</span>
                            <span>Date: ${formatDate(request.createdAt)}</span>
                            <span>${request.isOnline ? 'Online session' : 'In-person session'}</span>
                        </div>
                        ${request.isOnline && request.zoomLink
                            ? `<a class="inline-link" href="${escapeHtml(request.zoomLink)}" target="_blank" rel="noopener noreferrer">Open meeting link</a>`
                            : ''}
                    </div>
                    <span class="status-badge status-${escapeHtml(request.status)}">${escapeHtml(capitalizeWords(request.status))}</span>
                </div>
                <div class="price-strip">
                    <div>
                        <strong>${formatMoney(request.totalAmount, requestCurrency)}</strong>
                        <p>${request.paymentStatus ? 'Payment: ' + escapeHtml(capitalizeWords(request.paymentStatus)) : 'Awaiting payment update'}</p>
                        <div class="request-footnote">Chosen payment currency: ${escapeHtml(requestCurrency)}</div>
                    </div>
                    <span class="mode-chip">${request.chatRoom ? 'Chat ready' : 'Chat unavailable'}</span>
                </div>
                ${statusTracker(request.status)}
                <div class="action-row">
                    <div class="panel-actions">
                        ${getRequestActions(request)}
                        ${request.status === 'accepted' && request.paymentStatus === 'pending' && currentUser.role === 'client'
                            ? `<button class="btn" onclick="processPayment('${request._id}', '${requestCurrency}')">Pay now</button>`
                            : ''}
                        ${request.status === 'completed' && currentUser.role === 'client' && !(request.clientReview && request.clientReview.rating)
                            ? `<button class="btn-secondary" onclick="rateService('${request._id}')">Rate service</button>`
                            : ''}
                    </div>
                </div>
                ${renderEventPosts(eventPosts, request)}
            </article>
        `;
    }).join('');
}

function getRequestActions(request) {
    if (currentUser.role === 'provider' && request.status === 'pending') {
        return `
            <button class="btn-success" onclick="updateRequestStatus('${request._id}', 'accepted')">Accept</button>
            <button class="btn-danger" onclick="updateRequestStatus('${request._id}', 'rejected')">Reject</button>
        `;
    }

    if (currentUser.role === 'provider' && request.status === 'accepted') {
        return `
            <button class="btn-success" onclick="updateRequestStatus('${request._id}', 'in-progress')">Start service</button>
            <button class="btn-secondary" onclick="openChat('${request.chatRoom}')">Chat</button>
        `;
    }

    if (currentUser.role === 'provider' && request.status === 'in-progress') {
        return `
            <button class="btn-success" onclick="updateRequestStatus('${request._id}', 'completed')">Mark complete</button>
            <button class="btn-secondary" onclick="openChat('${request.chatRoom}')">Chat</button>
        `;
    }

    if (currentUser.role === 'provider' && request.status === 'completed' && request.paymentStatus === 'pending') {
        return `
            <button class="btn" onclick="requestPayment('${request._id}')">Request Payment</button>
            <button class="btn-secondary" onclick="openChat('${request.chatRoom}')">Chat</button>
        `;
    }

    if (currentUser.role === 'client' && request.paymentStatus === 'processing') {
        return `
            <button class="btn" onclick="confirmPaymentPin('${request._id}')">Confirm Payment</button>
            <button class="btn-secondary" onclick="openChat('${request.chatRoom}')">Chat</button>
        `;
    }

    if (request.status === 'completed') {
        return `
            <button class="btn-secondary" onclick="openChat('${request.chatRoom}')">Chat</button>
            <button class="btn" onclick="openEventPostModal('${request._id}')">Share event photos</button>
        `;
    }

    if (request.status === 'accepted' || request.status === 'in-progress') {
        return `<button class="btn-secondary" onclick="openChat('${request.chatRoom}')">Chat</button>`;
    }

    return '';
}

function renderEventPosts(eventPosts, request) {
    if (request.status !== 'completed' && !eventPosts.length) {
        return '';
    }

    if (!eventPosts.length) {
        return '<div class="empty-inline">No one has posted after-event photos yet. When the service is completed, both the client and provider can add shared photos here.</div>';
    }

    return `
        <div class="event-posts">
            ${eventPosts.slice().reverse().map(function (post) {
                return `
                    <div class="event-post">
                        <div class="event-post-head">
                            <div class="event-post-meta">
                                ${getAvatarMarkup(post.authorName, post.authorImage, 'tiny')}
                                <div class="event-post-author">
                                    <strong>${escapeHtml(post.authorName || 'Stand-In user')}</strong>
                                    <span>${escapeHtml(capitalizeWords(post.authorRole || 'member'))} · ${escapeHtml(formatDateTime(post.createdAt || new Date().toISOString()))}</span>
                                </div>
                            </div>
                        </div>
                        ${post.caption ? `<p>${escapeHtml(post.caption)}</p>` : ''}
                        ${Array.isArray(post.photos) && post.photos.length
                            ? `
                                <div class="event-gallery">
                                    ${post.photos.map(function (photo) {
                                        return `<img src="${escapeHtml(photo)}" alt="Event post photo">`;
                                    }).join('')}
                                </div>
                            `
                            : ''}
                    </div>
                `;
            }).join('')}
        </div>
    `;
}

async function rateService(requestId) {
    const rating = prompt('Rate this service from 1 to 5.');
    if (!rating || rating < 1 || rating > 5) {
        return;
    }

    const comment = prompt('Leave a comment (optional).') || '';

    try {
        const res = await fetch(`/api/requests/${requestId}/rate`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            },
            body: JSON.stringify({ rating: parseInt(rating, 10), comment: comment })
        });

        const data = await res.json();
        alert(res.ok ? 'Rating submitted.' : 'Error: ' + data.message);

        if (res.ok) {
            loadRequests();
            loadServices();
        }
    } catch (error) {
        alert('Network error.');
    }
}

async function loadProfile() {
    try {
        const res = await fetch('/api/services/profile', {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
        });

        if (!res.ok) {
            document.getElementById('profileName').value = currentUser.name || '';
            document.getElementById('profilePhone').value = currentUser.phone || '';
            document.getElementById('profileLocation').value = currentUser.location || '';
            document.getElementById('profileBio').value = currentUser.bio || '';
            setProfilePhotoPreview(currentUser.profileImage || '');
            return;
        }

        const user = await res.json();
        document.getElementById('profileName').value = user.name || '';
        document.getElementById('profilePhone').value = user.phone || '';
        document.getElementById('profileLocation').value = user.location || '';
        document.getElementById('profileBio').value = user.bio || '';
        profileImageData = user.profileImage || '';
        setProfilePhotoPreview(profileImageData);
        if (currentUser.role === 'provider' && document.getElementById('profileRate')) {
            document.getElementById('profileRate').value = user.hourlyRate || '';
        }
    } catch (error) {
        console.error(error);
    }
}

async function loadTransactions() {
    try {
        const res = await fetch('/api/payments/transactions', {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
        });
        if (res.ok) {
            const transactions = await res.json();
            displayTransactions(transactions);
            updatePaymentStats(transactions);
        }
    } catch (error) {
        console.error(error);
    }
}

function displayTransactions(transactions) {
    const list = document.getElementById('transactionsList');

    if (!transactions.length) {
        list.innerHTML = '<div class="empty-state"><h3>No transactions yet</h3><p>Payment activity will appear here after your first completed booking.</p></div>';
        return;
    }

    list.innerHTML = transactions.map(function (transaction) {
        const counterparty = currentUser.role === 'client'
            ? (transaction.provider && transaction.provider.name) || 'Provider'
            : (transaction.client && transaction.client.name) || 'Client';
        const payoutCopy = currentUser.role === 'provider'
            ? 'You earn: ' + formatMoney(transaction.providerAmount, transaction.currency || 'USD')
            : 'Commission: ' + formatMoney(transaction.adminCommission, transaction.currency || 'USD');
        const statusClass = transaction.status === 'completed'
            ? 'completed'
            : (transaction.status === 'pending' || transaction.status === 'processing' ? 'pending' : 'rejected');

        return `
            <article class="transaction-card">
                <div class="card-row">
                    <div>
                        <h4>${escapeHtml((transaction.serviceRequest && transaction.serviceRequest.title) || 'Service request')}</h4>
                        <div class="meta-copy">
                            <span>${currentUser.role === 'client' ? 'Provider' : 'Client'}: ${escapeHtml(counterparty)}</span>
                            <span>Receipt: ${escapeHtml(transaction.receiptNumber || 'Pending')}</span>
                            <span>Date: ${formatDate(transaction.createdAt)}</span>
                        </div>
                    </div>
                    <span class="status-badge status-${statusClass}">${escapeHtml(capitalizeWords(transaction.status))}</span>
                </div>
                <div class="price-strip">
                    <div>
                        <strong>${formatMoney(transaction.totalAmount, transaction.currency || 'USD')}</strong>
                        <p>${escapeHtml(payoutCopy)}</p>
                        <div class="request-footnote">Settlement currency: ${escapeHtml(transaction.currency || 'USD')}</div>
                    </div>
                </div>
            </article>
        `;
    }).join('');
}

function updatePaymentStats(transactions) {
    const completed = transactions.filter(function (transaction) {
        return transaction.status === 'completed';
    });
    const pending = transactions.filter(function (transaction) {
        return ['pending', 'processing'].includes(transaction.status);
    });

    document.getElementById('completedPayments').textContent = completed.length;
    document.getElementById('pendingPayments').textContent = pending.length;

    if (currentUser.role === 'provider') {
        document.getElementById('totalEarningsDisplay').textContent = formatMoney(completed.reduce(function (sum, transaction) {
            return sum + Number(transaction.baseProviderAmount || transaction.providerAmount || 0);
        }, 0));
        document.querySelector('#totalEarningsDisplay + .stat-label').textContent = 'USD equivalent';
    } else {
        document.getElementById('totalEarningsDisplay').textContent = formatMoney(completed.reduce(function (sum, transaction) {
            return sum + Number(transaction.baseTotalAmount || transaction.totalAmount || 0);
        }, 0));
        document.querySelector('#totalEarningsDisplay + .stat-label').textContent = 'USD equivalent spent';
    }
}

async function processPayment(requestId, paymentCurrency) {
    try {
        const methodsRes = await fetch('/api/payments/methods', {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
        });

        if (!methodsRes.ok) {
            return;
        }

        const methods = await methodsRes.json();
        if (!methods.length) {
            if (confirm('Add a payment method first. Go to payment setup?')) {
                window.location.href = 'payment-setup.html';
            }
            return;
        }

        const defaultMethod = methods.find(function (method) {
            return method.isDefault;
        }) || methods[0];

        const res = await fetch(`/api/payments/process/${requestId}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            },
            body: JSON.stringify({
                clientPaymentMethodId: defaultMethod._id,
                paymentCurrency: paymentCurrency || 'USD'
            })
        });

        const result = await res.json();
        if (res.ok) {
            alert('Payment initiated. Total: ' + formatMoney(result.breakdown.totalAmount, result.breakdown.currency || paymentCurrency || 'USD'));
            loadRequests();
            loadStats();
            loadTransactions();
            showDashboardTab('payments');
        } else {
            alert('Error: ' + result.message);
        }
    } catch (error) {
        alert('Network error.');
    }
}

async function loadLocations() {
    try {
        const res = await fetch('/api/locations/user/my-locations', {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
        });
        if (res.ok) {
            const locations = await res.json();
            displayLocations(locations);
            updateLocationStats(locations);
        }

        if (currentUser.role === 'provider') {
            const receivedRes = await fetch('/api/locations/shared/with-me', {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
            });
            if (receivedRes.ok) {
                const sharedLocations = await receivedRes.json();
                document.getElementById('receivedLocationsCard').style.display = 'block';
                document.getElementById('receivedLocations').textContent = sharedLocations.length;
            }
        }
    } catch (error) {
        console.error(error);
    }
}

function displayLocations(locations) {
    const list = document.getElementById('locationsList');

    if (!locations.length) {
        list.innerHTML = '<div class="empty-state"><h3>No locations shared yet</h3><p>Share your location when you want more precise coordination.</p></div>';
        return;
    }

    list.innerHTML = locations.map(function (location) {
        const address = location.address && location.address.fullAddress
            ? location.address.fullAddress
            : `${location.coordinates.latitude}, ${location.coordinates.longitude}`;

        return `
            <article class="location-card">
                <div class="card-row">
                    <div>
                        <h4>${location.locationName ? escapeHtml(location.locationName) : 'Shared location'}</h4>
                        <div class="meta-copy">
                            <span>${escapeHtml(address)}</span>
                            <span>Date: ${formatDate(location.createdAt)}</span>
                            ${location.serviceRequest ? `<span>Request: ${escapeHtml(location.serviceRequest.title)}</span>` : ''}
                        </div>
                    </div>
                    <span class="status-badge status-${location.isLiveSharing ? 'accepted' : 'completed'}">${location.isLiveSharing ? 'Live' : 'Static'}</span>
                </div>
                <div class="action-row">
                    <button class="btn-secondary" onclick="viewSharedLocation('${location._id}')">View</button>
                    ${location.isLiveSharing
                        ? `<button class="btn-danger" onclick="stopLocationSharing('${location._id}')">Stop</button>`
                        : `<button class="btn-danger" onclick="deleteSharedLocation('${location._id}')">Delete</button>`}
                </div>
            </article>
        `;
    }).join('');
}

function updateLocationStats(locations) {
    document.getElementById('sharedLocations').textContent = locations.length;
    document.getElementById('liveLocations').textContent = locations.filter(function (location) {
        return location.isLiveSharing;
    }).length;
}

function viewSharedLocation(id) {
    window.open(`location-view.html?id=${id}`, '_blank');
}

async function stopLocationSharing(id) {
    const res = await fetch(`/api/locations/stop-live/${id}`, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
    });
    if (res.ok) {
        alert('Live sharing stopped.');
        loadLocations();
    } else {
        alert('Error stopping location.');
    }
}

async function deleteSharedLocation(id) {
    if (!confirm('Delete this location?')) {
        return;
    }
    const res = await fetch(`/api/locations/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
    });
    if (res.ok) {
        alert('Location deleted.');
        loadLocations();
    } else {
        alert('Error deleting location.');
    }
}

function setRequestLoading(loading) {
    const button = document.getElementById('requestSubmitBtn');
    document.getElementById('requestSubmitText').style.display = loading ? 'none' : 'inline';
    document.getElementById('requestSubmitLoading').style.display = loading ? 'inline-block' : 'none';
    button.disabled = loading;
    button.style.opacity = loading ? '0.8' : '1';
}

function setServiceMode(isOnline) {
    document.getElementById('requestOnline').value = String(isOnline);
    document.getElementById('btnOnline').classList.toggle('active', isOnline);
    document.getElementById('btnOffline').classList.toggle('active', !isOnline);
    document.getElementById('zoomNotice').style.display = isOnline ? 'block' : 'none';
    document.getElementById('locationSection').style.display = isOnline ? 'none' : 'block';
}

function getStaticLocation() {
    if (!navigator.geolocation) {
        alert('Geolocation is not supported.');
        return;
    }
    document.getElementById('locationStatus').textContent = 'Getting your current location...';
    navigator.geolocation.getCurrentPosition(function (position) {
        capturedLocation = { latitude: position.coords.latitude, longitude: position.coords.longitude, type: 'static' };
        document.getElementById('requestLocation').value = `${position.coords.latitude.toFixed(5)}, ${position.coords.longitude.toFixed(5)}`;
        document.getElementById('locationStatus').textContent = 'Location captured successfully.';
    }, function () {
        document.getElementById('locationStatus').textContent = 'Could not get your current location. Enter it manually instead.';
    });
}

function startLiveLocation() {
    if (!navigator.geolocation) {
        alert('Geolocation is not supported.');
        return;
    }
    document.getElementById('locationStatus').textContent = 'Preparing live GPS sharing...';
    navigator.geolocation.getCurrentPosition(function (position) {
        capturedLocation = { latitude: position.coords.latitude, longitude: position.coords.longitude, type: 'live', isLive: true };
        document.getElementById('requestLocation').value = `${position.coords.latitude.toFixed(5)}, ${position.coords.longitude.toFixed(5)}`;
        document.getElementById('locationStatus').textContent = 'Live GPS sharing will start when the request is submitted.';
    }, function () {
        document.getElementById('locationStatus').textContent = 'Could not access live GPS.';
    });
}

function requestService(providerId, fromProfileModal = false) {
    if (fromProfileModal) {
        closeProviderModal();
    }
    document.getElementById('requestForm').reset();
    document.getElementById('selectedProviderId').value = providerId;
    capturedLocation = null;
    document.getElementById('locationStatus').textContent = '';
    document.getElementById('requestCurrency').value = 'USD';
    setServiceMode(false);
    document.getElementById('requestModal').style.display = 'block';
}

function closeModal() {
    document.getElementById('requestModal').style.display = 'none';
    if (liveLocationInterval) {
        clearInterval(liveLocationInterval);
        liveLocationInterval = null;
    }
}

function openEventPostModal(requestId) {
    document.getElementById('eventRequestId').value = requestId;
    document.getElementById('eventCaption').value = '';
    document.getElementById('eventPhotos').value = '';
    eventPostPhotos = [];
    renderEventPhotoPreview();
    document.getElementById('eventPostModal').style.display = 'block';
}

function closeEventPostModal() {
    document.getElementById('eventPostModal').style.display = 'none';
}

function renderEventPhotoPreview() {
    const preview = document.getElementById('eventPhotoPreview');

    if (!preview) {
        return;
    }

    preview.innerHTML = eventPostPhotos.map(function (photo, index) {
        return `<img src="${escapeHtml(photo)}" alt="Selected event photo ${index + 1}">`;
    }).join('');
}

async function updateRequestStatus(requestId, status) {
    try {
        const res = await fetch(`/api/requests/${requestId}/status`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            },
            body: JSON.stringify({ status: status })
        });
        if (res.ok) {
            loadRequests();
            loadStats();
        }
    } catch (error) {
        console.error(error);
    }
}

function openChat(roomId) {
    window.open(`chat.html?room=${roomId}`, '_blank', 'width=420,height=620');
}

async function requestPayment(requestId) {
    try {
        const res = await fetch(`/api/payments/request/${requestId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('token')}` }
        });
        const data = await res.json();
        if (res.ok) {
            alert('Payment request sent to client. They will be notified to confirm.\n\nAmount: ' + formatMoney(data.breakdown.totalAmount, data.breakdown.currency));
            loadRequests();
            loadInvoices();
        } else {
            alert('Error: ' + data.message);
        }
    } catch { alert('Network error.'); }
}

async function confirmPaymentPin(requestId) {
    // Find the pending transaction for this request
    try {
        const txRes = await fetch('/api/payments/transactions', {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
        });
        const transactions = txRes.ok ? await txRes.json() : [];
        const tx = transactions.find(t => t.serviceRequest && (t.serviceRequest._id || t.serviceRequest) === requestId && t.status === 'pending');
        if (!tx) { alert('No pending payment found for this request.'); return; }

        const pin = prompt('Enter your 4-digit payment PIN to confirm:');
        if (!pin) return;

        const res = await fetch(`/api/payments/confirm-pin/${tx._id}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('token')}` },
            body: JSON.stringify({ pin })
        });
        const data = await res.json();
        if (res.ok) {
            alert('Payment confirmed! ✓\n\nTotal: ' + formatMoney(data.breakdown.totalAmount, data.breakdown.currency) + '\nProvider receives: ' + formatMoney(data.breakdown.providerReceives, data.breakdown.currency));
            loadRequests();
            loadStats();
            loadTransactions();
            loadInvoices();
        } else {
            alert('Error: ' + data.message);
        }
    } catch { alert('Network error.'); }
}

async function loadInvoices() {
    try {
        const res = await fetch('/api/invoices', {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
        });
        if (res.ok) displayInvoices(await res.json());
    } catch (e) { console.error(e); }
}

function displayInvoices(invoices) {
    const container = document.getElementById('invoicesList');
    if (!container) return;
    if (!invoices.length) {
        container.innerHTML = '<div class="empty-state"><h3>No invoices yet</h3><p>Invoices and receipts will appear here after payment activity.</p></div>';
        return;
    }
    const typeColors = { invoice: '#41e4de', receipt: '#69f1c5', performance: '#f6c177' };
    container.innerHTML = invoices.map(inv => `
        <article class="transaction-card">
            <div class="card-row">
                <div>
                    <h4>${escapeHtml(inv.invoiceNumber)}</h4>
                    <div class="meta-copy">
                        <span>${escapeHtml(inv.serviceTitle || 'Service')}</span>
                        <span>Date: ${formatDate(inv.issuedAt)}</span>
                        <span style="color:${typeColors[inv.type] || '#41e4de'};font-weight:700;text-transform:uppercase;">${escapeHtml(inv.type)}</span>
                    </div>
                </div>
                <span class="status-badge status-${inv.status === 'paid' ? 'completed' : 'pending'}">${escapeHtml(inv.status.toUpperCase())}</span>
            </div>
            <div class="price-strip">
                <strong>${formatMoney(inv.totalAmount, inv.currency)}</strong>
                <a href="/api/invoices/${inv._id}?format=html" target="_blank" class="btn-secondary" style="padding:8px 16px;border-radius:999px;text-decoration:none;font-size:13px;">View / Print</a>
            </div>
        </article>
    `).join('');
}

function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.href = 'login.html';
}

document.addEventListener('submit', async function (event) {
    if (event.target.id === 'requestForm') {
        event.preventDefault();
        setRequestLoading(true);
        const isOnline = document.getElementById('requestOnline').value === 'true';

        try {
            const methodsRes = await fetch('/api/payments/methods', {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
            });
            const methods = methodsRes.ok ? await methodsRes.json() : [];

            if (!methods.length) {
                setRequestLoading(false);
                if (confirm('You need a payment method before requesting. Go to payment setup?')) {
                    window.location.href = 'payment-setup.html';
                }
                return;
            }

            const paymentMethodId = (methods.find(function (method) {
                return method.isDefault;
            }) || methods[0])._id;

            if (!isOnline && !capturedLocation && !document.getElementById('requestLocation').value) {
                setRequestLoading(false);
                alert('Please share your location or enter an address for in-person services.');
                return;
            }

            const formData = {
                providerId: document.getElementById('selectedProviderId').value,
                serviceType: 'general',
                title: document.getElementById('requestTitle').value,
                description: document.getElementById('requestDescription').value,
                duration: parseInt(document.getElementById('requestDuration').value, 10),
                scheduledDate: document.getElementById('requestDate').value,
                location: document.getElementById('requestLocation').value,
                clientLocation: capturedLocation ? `${capturedLocation.latitude},${capturedLocation.longitude}` : document.getElementById('requestLocation').value,
                isOnline: isOnline,
                paymentMethodId: paymentMethodId,
                paymentCurrency: document.getElementById('requestCurrency').value
            };

            const res = await fetch('/api/requests', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                },
                body: JSON.stringify(formData)
            });

            const result = await res.json();
            if (res.ok) {
                closeModal();
                loadRequests();
                loadStats();
                let message = 'Request sent successfully.';
                if (result.zoomLink) {
                    message += `\n\nMeeting link: ${result.zoomLink}`;
                }
                alert(message);
                showDashboardTab('requests');
            } else {
                alert('Error: ' + result.message);
            }
        } catch (error) {
            alert('Network error.');
        } finally {
            setRequestLoading(false);
        }
    }

    if (event.target.id === 'profileForm') {
        event.preventDefault();

        const finalProfileImage = profileImageData || currentUser.profileImage;
        if (!finalProfileImage) {
            alert('A profile photo is required before you can save your account.');
            return;
        }

        const updates = {
            name: document.getElementById('profileName').value,
            phone: document.getElementById('profilePhone').value,
            location: document.getElementById('profileLocation').value,
            bio: document.getElementById('profileBio').value,
            profileImage: finalProfileImage
        };

        if (currentUser.role === 'provider') {
            updates.hourlyRate = parseFloat(document.getElementById('profileRate').value);
        }

        try {
            const res = await fetch('/api/services/profile', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                },
                body: JSON.stringify(updates)
            });

            const user = await res.json();
            if (res.ok) {
                const stored = JSON.parse(localStorage.getItem('user') || '{}');
                stored.id = user.id || stored.id;
                stored.name = user.name;
                stored.phone = user.phone;
                stored.location = user.location;
                stored.bio = user.bio;
                stored.profileImage = user.profileImage;
                localStorage.setItem('user', JSON.stringify(stored));
                currentUser = stored;
                document.getElementById('userName').textContent = user.name;
                setUserAvatar('userAvatar', currentUser);
                setProfilePhotoPreview(user.profileImage);
                alert('Profile updated.');
                loadServices();
            } else {
                alert('Error: ' + user.message);
            }
        } catch (error) {
            alert('Network error.');
        }
    }

    if (event.target.id === 'eventPostForm') {
        event.preventDefault();

        const requestId = document.getElementById('eventRequestId').value;
        const caption = document.getElementById('eventCaption').value.trim();

        if (!caption && !eventPostPhotos.length) {
            alert('Add a caption or at least one event photo before posting.');
            return;
        }

        try {
            const res = await fetch(`/api/requests/${requestId}/event-posts`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                },
                body: JSON.stringify({
                    caption: caption,
                    photos: eventPostPhotos
                })
            });

            const result = await res.json();
            if (res.ok) {
                closeEventPostModal();
                alert('Event post shared.');
                loadRequests();
            } else {
                alert('Error: ' + result.message);
            }
        } catch (error) {
            alert('Network error.');
        }
    }
});

window.addEventListener('click', function (event) {
    if (event.target === document.getElementById('requestModal')) {
        closeModal();
    }
    if (event.target === document.getElementById('providerProfileModal')) {
        closeProviderModal();
    }
    if (event.target === document.getElementById('eventPostModal')) {
        closeEventPostModal();
    }
});
