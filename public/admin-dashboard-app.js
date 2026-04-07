let currentAdmin = null;
let allUsers = [];
let allRequests = [];

document.addEventListener('DOMContentLoaded', function () {
    checkAuth();
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

function formatMoney(value) {
    return '$' + Number(value || 0).toFixed(2);
}

function formatDate(value) {
    return new Date(value).toLocaleDateString();
}

function checkAuth() {
    const token = localStorage.getItem('token');
    const user = localStorage.getItem('user');

    if (!token || !user) {
        window.location.href = 'login.html';
        return;
    }

    try {
        currentAdmin = JSON.parse(user);
    } catch (error) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        window.location.href = 'login.html';
        return;
    }

    if (currentAdmin.role !== 'admin') {
        alert('Access denied. Admin privileges required.');
        window.location.href = 'dashboard.html';
        return;
    }

    document.getElementById('adminName').textContent = currentAdmin.name;
    document.getElementById('adminRole').textContent = currentAdmin.role;
    document.getElementById('adminAvatar').textContent = currentAdmin.name.charAt(0).toUpperCase();
}

async function loadDashboard() {
    await Promise.all([
        loadStats(),
        loadUsers(),
        loadRequests(),
        loadAnalytics()
    ]);
    renderRecentActivity();
}

async function loadStats() {
    try {
        const response = await fetch('/api/admin/dashboard', {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
        });

        if (!response.ok) {
            return;
        }

        const stats = await response.json();
        document.getElementById('totalUsers').textContent = stats.totalUsers;
        document.getElementById('totalProviders').textContent = stats.totalProviders;
        document.getElementById('totalClients').textContent = stats.totalClients;
        document.getElementById('totalRequests').textContent = stats.totalRequests;
        document.getElementById('completedRequests').textContent = stats.completedRequests;
        document.getElementById('totalCommission').textContent = formatMoney(stats.totalCommission);
        document.getElementById('adminFocusMetric').textContent = formatMoney(stats.totalCommission);
    } catch (error) {
        console.error('Error loading stats:', error);
    }
}

async function loadUsers() {
    try {
        const response = await fetch('/api/admin/users', {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
        });

        if (response.ok) {
            const data = await response.json();
            allUsers = data.users || data;
            displayUsers(allUsers);
            renderRecentActivity();
        }
    } catch (error) {
        console.error('Error loading users:', error);
    }
}

function displayUsers(users) {
    const tbody = document.getElementById('usersTableBody');

    if (users.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No users found</td></tr>';
        return;
    }

    tbody.innerHTML = users.map(function (user) {
        return `
            <tr>
                <td>
                    <div class="table-user">
                        <div class="table-avatar">${escapeHtml((user.name || 'U').charAt(0))}</div>
                        <div>
                            <div>${escapeHtml(user.name)}</div>
                            <div class="table-note">${escapeHtml(user.phone || 'No phone')}</div>
                        </div>
                    </div>
                </td>
                <td>${escapeHtml(user.email)}</td>
                <td><span class="status-badge status-${user.role === 'provider' ? 'verified' : 'active'}">${escapeHtml(user.role)}</span></td>
                <td>
                    <span class="status-badge status-${user.isActive ? 'active' : 'inactive'}">${user.isActive ? 'Active' : 'Inactive'}</span>
                    ${user.isVerified ? '<span class="status-badge status-verified" style="margin-left:8px;">Verified</span>' : ''}
                </td>
                <td>${formatDate(user.createdAt)}</td>
                <td>
                    <div class="panel-actions">
                        ${user.role === 'provider' ? `<button class="${user.isVerified ? 'btn-secondary' : 'btn-success'}" onclick="toggleVerification('${user._id}', ${!user.isVerified})">${user.isVerified ? 'Revoke' : 'Approve'}</button>` : ''}
                        <button class="${user.isActive ? 'btn-danger' : 'btn-outline'}" onclick="toggleUserStatus('${user._id}', ${!user.isActive})">${user.isActive ? 'Deactivate' : 'Activate'}</button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

async function loadRequests() {
    try {
        const response = await fetch('/api/admin/requests', {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
        });

        if (response.ok) {
            const data = await response.json();
            allRequests = data.requests || data;
            displayRequests(allRequests);
            renderRecentActivity();
        }
    } catch (error) {
        console.error('Error loading requests:', error);
    }
}

function displayRequests(requests) {
    const tbody = document.getElementById('requestsTableBody');

    if (requests.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="empty-state">No requests found</td></tr>';
        return;
    }

    tbody.innerHTML = requests.map(function (request) {
        return `
            <tr>
                <td>
                    <div>${escapeHtml(request.title)}</div>
                    <div class="table-note">${escapeHtml(request.serviceType || 'General')}</div>
                </td>
                <td>
                    <div class="table-user">
                        <div class="table-avatar">${escapeHtml(((request.client && request.client.name) || 'C').charAt(0))}</div>
                        <div>
                            <div>${escapeHtml((request.client && request.client.name) || 'Client')}</div>
                            <div class="table-note">${escapeHtml((request.client && request.client.email) || '')}</div>
                        </div>
                    </div>
                </td>
                <td>
                    <div class="table-user">
                        <div class="table-avatar">${escapeHtml(((request.provider && request.provider.name) || 'P').charAt(0))}</div>
                        <div>
                            <div>${escapeHtml((request.provider && request.provider.name) || 'Provider')}</div>
                            <div class="table-note">${escapeHtml((request.provider && request.provider.email) || '')}</div>
                        </div>
                    </div>
                </td>
                <td>
                    <div>${formatMoney(request.totalAmount)}</div>
                    <div class="table-note">Commission: ${formatMoney(request.adminCommission)}</div>
                </td>
                <td><span class="status-badge status-${escapeHtml(request.status)}">${escapeHtml(capitalizeWords(request.status))}</span></td>
                <td>${formatDate(request.createdAt)}</td>
                <td><button class="btn-secondary" onclick="viewRequestDetails('${request._id}')">View</button></td>
            </tr>
        `;
    }).join('');
}

async function toggleVerification(userId, verify) {
    try {
        const response = await fetch(`/api/admin/users/${userId}/verify`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            },
            body: JSON.stringify({ isVerified: verify })
        });

        if (response.ok) {
            loadUsers();
        }
    } catch (error) {
        console.error('Error updating verification:', error);
    }
}

function filterUsers() {
    const searchTerm = document.getElementById('userSearch').value.toLowerCase();
    const filteredUsers = allUsers.filter(function (user) {
        return user.name.toLowerCase().includes(searchTerm)
            || user.email.toLowerCase().includes(searchTerm)
            || user.role.toLowerCase().includes(searchTerm);
    });
    displayUsers(filteredUsers);
}

function filterRequests() {
    const filterValue = document.getElementById('requestFilter').value;
    const filteredRequests = filterValue
        ? allRequests.filter(function (request) { return request.status === filterValue; })
        : allRequests;
    displayRequests(filteredRequests);
}

async function toggleUserStatus(userId, isActive) {
    try {
        await fetch(`/api/admin/users/${userId}/status`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            },
            body: JSON.stringify({ isActive: isActive })
        });
        loadUsers();
    } catch (error) {
        console.error(error);
    }
}

function viewRequestDetails(requestId) {
    const request = allRequests.find(function (item) { return item._id === requestId; });
    if (!request) {
        return;
    }

    alert(
        `Request: ${request.title}\n` +
        `Client: ${(request.client && request.client.name) || 'Client'}\n` +
        `Provider: ${(request.provider && request.provider.name) || 'Provider'}\n` +
        `Amount: ${formatMoney(request.totalAmount)}\n` +
        `Status: ${request.status}\n` +
        `Payment: ${request.paymentStatus || 'pending'}\n` +
        `Date: ${new Date(request.createdAt).toLocaleString()}`
    );
}

function renderRecentActivity() {
    const list = document.getElementById('recentActivity');
    const userEvents = allUsers.map(function (user) {
        return {
            title: `${user.name} joined the platform`,
            detail: `${capitalizeWords(user.role)} account created`,
            date: user.createdAt,
            tag: 'User'
        };
    });
    const requestEvents = allRequests.map(function (request) {
        return {
            title: request.title,
            detail: `Request from ${(request.client && request.client.name) || 'Client'} to ${(request.provider && request.provider.name) || 'Provider'}`,
            date: request.createdAt,
            tag: 'Request'
        };
    });

    const activity = userEvents.concat(requestEvents)
        .sort(function (left, right) { return new Date(right.date) - new Date(left.date); })
        .slice(0, 6);

    if (!activity.length) {
        list.innerHTML = '<div class="empty-state"><h3>No recent activity</h3><p>Recent user and request activity will appear here.</p></div>';
        return;
    }

    list.innerHTML = activity.map(function (item) {
        return `
            <div class="activity-item">
                <div>
                    <h4>${escapeHtml(item.title)}</h4>
                    <div class="table-note">${escapeHtml(item.detail)}</div>
                </div>
                <div style="text-align:right;">
                    <span class="timeline-chip">${escapeHtml(item.tag)}</span>
                    <div class="table-note" style="margin-top:8px;">${formatDate(item.date)}</div>
                </div>
            </div>
        `;
    }).join('');
}

async function loadAnalytics() {
    try {
        const response = await fetch('/api/admin/analytics', {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
        });

        if (!response.ok) {
            return;
        }

        const data = await response.json();
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

        const revenueHtml = data.revenueByMonth.length
            ? `<div class="panel-list">${data.revenueByMonth.map(function (item) {
                return `
                    <div class="activity-item">
                        <div>
                            <h4>${months[item._id.month - 1]} ${item._id.year}</h4>
                            <div class="table-note">${item.count} completed transactions</div>
                        </div>
                        <div style="text-align:right;">
                            <div>${formatMoney(item.revenue)}</div>
                            <div class="table-note">Commission: ${formatMoney(item.commission)}</div>
                        </div>
                    </div>
                `;
            }).join('')}</div>`
            : '<div class="empty-state"><h3>No revenue data</h3><p>Completed transactions will feed this panel once payments start settling.</p></div>';
        document.getElementById('revenueChart').innerHTML = revenueHtml;

        const growthMap = {};
        data.userGrowth.forEach(function (item) {
            const key = `${months[item._id.month - 1]} ${item._id.year}`;
            if (!growthMap[key]) {
                growthMap[key] = { clients: 0, providers: 0 };
            }
            if (item._id.role === 'client') {
                growthMap[key].clients = item.count;
            }
            if (item._id.role === 'provider') {
                growthMap[key].providers = item.count;
            }
        });

        const growthEntries = Object.keys(growthMap);
        const growthHtml = growthEntries.length
            ? `<div class="panel-list">${growthEntries.map(function (month) {
                const item = growthMap[month];
                return `
                    <div class="activity-item">
                        <div>
                            <h4>${month}</h4>
                            <div class="table-note">New accounts added to the marketplace</div>
                        </div>
                        <div style="text-align:right;">
                            <div>Clients: ${item.clients}</div>
                            <div class="table-note">Providers: ${item.providers}</div>
                        </div>
                    </div>
                `;
            }).join('')}</div>`
            : '<div class="empty-state"><h3>No user growth data</h3><p>New signups in the last months will appear here automatically.</p></div>';
        document.getElementById('userGrowthChart').innerHTML = growthHtml;

        const servicesHtml = data.popularServices.length
            ? `<div class="activity-list">${data.popularServices.map(function (service, index) {
                return `
                    <div class="activity-item">
                        <div>
                            <h4>${index + 1}. ${escapeHtml(capitalizeWords(service._id || 'general'))}</h4>
                            <div class="table-note">${service.count} requests on this service type</div>
                        </div>
                        <div style="text-align:right;">
                            <div>${formatMoney(service.totalRevenue || 0)}</div>
                            <div class="table-note">Revenue generated</div>
                        </div>
                    </div>
                `;
            }).join('')}</div>`
            : '<div class="empty-state"><h3>No service data</h3><p>Popular services will appear once requests begin to accumulate.</p></div>';
        document.getElementById('popularServices').innerHTML = servicesHtml;
    } catch (error) {
        console.error('Analytics error:', error);
    }
}

function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.href = 'login.html';
}
