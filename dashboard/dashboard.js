document.addEventListener('DOMContentLoaded', () => {
    const todaySpendingEl = document.getElementById('today-spending');
    const remainingBudgetEl = document.getElementById('remaining-budget');
    const utilizationPctEl = document.getElementById('utilization-pct');
    const utilizationFillEl = document.getElementById('utilization-fill');
    const sealsBody = document.getElementById('seals-body');
    const rejectedBody = document.getElementById('rejected-body');
    const auditBody = document.getElementById('audit-body');
    const refreshBtn = document.getElementById('refresh-btn');
    const maxBudgetInput = document.getElementById('max-daily-budget');
    const saveSettingsBtn = document.getElementById('save-settings');

    const escapeHtml = (value) => {
        if (value === null || value === undefined) return '';
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    };

    const formatTimestamp = (ts) => {
        if (!ts) return '';
        const d = new Date(ts);
        return isNaN(d.getTime()) ? ts : d.toLocaleString();
    };

    let sealsData = [];

    const formatCurrency = (amount) => {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD',
        }).format(amount);
    };

    const fetchData = async () => {
        try {
            const [budgetRes, sealsRes, rejectedRes, auditRes] = await Promise.all([
                fetch('/api/budget/today'),
                fetch('/api/seals'),
                fetch('/api/seals?status=rejected'),
                fetch('/api/audit')
            ]);

            const budget = await budgetRes.json();
            sealsData = await sealsRes.json();
            const rejected = await rejectedRes.json();
            const audit = await auditRes.json();

            updateBudget(budget);
            renderSeals(sealsData);
            renderRejected(rejected);
            renderAudit(audit);
        } catch (error) {
            console.error('Failed to fetch dashboard data:', error);
        }
    };

    const updateBudget = (data) => {
        const { spent, max, remaining } = data;
        todaySpendingEl.textContent = formatCurrency(spent);
        remainingBudgetEl.textContent = formatCurrency(remaining);
        
        const utilization = max > 0 ? (spent / max) * 100 : 0;
        utilizationPctEl.textContent = `${utilization.toFixed(1)}%`;
        utilizationFillEl.style.width = `${Math.min(utilization, 100)}%`;
        
        if (utilization >= 90) {
            utilizationFillEl.style.backgroundColor = 'var(--danger-red)';
        } else if (utilization >= 70) {
            utilizationFillEl.style.backgroundColor = 'var(--warning-amber)';
        } else {
            utilizationFillEl.style.backgroundColor = 'var(--accent-green)';
        }

        maxBudgetInput.value = max;
    };

    const renderSeals = (seals) => {
        sealsBody.innerHTML = '';
        seals.forEach(seal => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${escapeHtml(seal.seal_id)}</td>
                <td>${formatCurrency(seal.amount)}</td>
                <td>${escapeHtml(seal.vendor)}</td>
                <td style="color: ${getStatusColor(seal.status)}">${escapeHtml(seal.status)}</td>
                <td>${escapeHtml(seal.masked_card || 'N/A')}</td>
                <td>${escapeHtml(formatTimestamp(seal.timestamp))}</td>
            `;
            sealsBody.appendChild(row);
        });
    };

    const renderRejected = (rejected) => {
        rejectedBody.innerHTML = '';
        rejected.forEach(seal => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${escapeHtml(seal.seal_id)}</td>
                <td>${formatCurrency(seal.amount)}</td>
                <td>${escapeHtml(seal.vendor)}</td>
                <td>${escapeHtml(seal.rejection_reason || '')}</td>
                <td>${escapeHtml(formatTimestamp(seal.timestamp))}</td>
            `;
            rejectedBody.appendChild(row);
        });
    };

    const getOutcomeColor = (outcome) => {
        switch ((outcome || '').toLowerCase()) {
            case 'approved': return 'var(--accent-green)';
            case 'rejected_vendor':
            case 'rejected_security':
            case 'error_injector':
            case 'error_fields': return 'var(--danger-red)';
            case 'blocked_bypassed': return 'var(--warning-orange, #ffa500)';
            case 'unknown':
            case '':
            case null: return 'var(--text-secondary)';
            default: return 'var(--text-primary)';
        }
    };

    const renderAudit = (events) => {
        if (!auditBody) return;
        auditBody.innerHTML = '';
        events.forEach(event => {
            const row = document.createElement('tr');
            const outcome = event.outcome || '';
            const outcomeColor = getOutcomeColor(outcome);
            row.innerHTML = `
                <td>${escapeHtml(event.id)}</td>
                <td>${escapeHtml(event.event_type)}</td>
                <td>${escapeHtml(event.vendor || '')}</td>
                <td style="color: ${outcomeColor}">${escapeHtml(outcome || '—')}</td>
                <td>${escapeHtml(event.reasoning || '')}</td>
                <td>${escapeHtml(event.rejection_reason || '')}</td>
                <td>${escapeHtml(formatTimestamp(event.timestamp))}</td>
            `;
            auditBody.appendChild(row);
        });
    };

    const getStatusColor = (status) => {
        switch (status.toLowerCase()) {
            case 'issued': return 'var(--accent-green)';
            case 'used': return 'var(--text-secondary)';
            case 'rejected': return 'var(--danger-red)';
            default: return 'var(--text-primary)';
        }
    };

    const saveSettings = async () => {
        const maxBudget = parseFloat(maxBudgetInput.value);
        if (isNaN(maxBudget)) return;

        try {
            await fetch('/api/settings/max_daily_budget', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ value: maxBudget.toString() })
            });
            fetchData();
        } catch (error) {
            console.error('Failed to save settings:', error);
        }
    };

    // Sorting logic
    document.querySelectorAll('#seals-table th[data-sort]').forEach(th => {
        th.addEventListener('click', () => {
            const prop = th.dataset.sort;
            const sorted = [...sealsData].sort((a, b) => {
                if (a[prop] < b[prop]) return -1;
                if (a[prop] > b[prop]) return 1;
                return 0;
            });
            renderSeals(sorted);
        });
    });

    refreshBtn.addEventListener('click', fetchData);
    saveSettingsBtn.addEventListener('click', saveSettings);

    // Initial load
    fetchData();
});
