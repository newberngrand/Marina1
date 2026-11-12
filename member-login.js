/* Member login backed by Supabase.
   Members sign in with their SLIP number and password. Each slip has its own
   Supabase account whose internal login address is built from the slip, so
   ownership can change hands without changing the slip's login.
   "Forgot password" asks for slip + email; the server checks the email
   against the one on file before sending a reset link. */
(function () {
  var SUPABASE_URL = 'https://afejychfqezorwyqfcsh.supabase.co';
  var SUPABASE_KEY = 'sb_publishable_feYqbTeGauYt9xQaQk0mtw_7ZZsFbmM'; // public key; data is protected by database rules
  var SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js';
  var PORTAL_PAGE = 'member-portal.html';

  var clientPromise = null;
  var overlay = null;

  function slipEmail(slip) {
    return 'slip-' + slip.toLowerCase() + '@members.newberngrand.com';
  }
  function normSlip(v) {
    return String(v || '').trim().toUpperCase().replace(/\s+/g, '');
  }

  function getClient() {
    if (clientPromise) return clientPromise;
    clientPromise = new Promise(function (resolve, reject) {
      function make() {
        resolve(window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
          auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
        }));
      }
      if (window.supabase && window.supabase.createClient) return make();
      var s = document.createElement('script');
      s.src = SUPABASE_JS;
      s.onload = make;
      s.onerror = function () { reject(new Error('Could not load the login service. Please check your connection and try again.')); };
      document.head.appendChild(s);
    });
    return clientPromise;
  }

  function buildModal() {
    overlay = document.createElement('div');
    overlay.className = 'member-login-overlay';
    overlay.id = 'memberLoginOverlay';
    overlay.innerHTML =
      '<div class="member-login-modal" role="dialog" aria-modal="true" aria-labelledby="memberLoginTitle">' +
        '<button type="button" class="member-login-close" aria-label="Close">&times;</button>' +
        '<div data-view="login">' +
          '<h3 id="memberLoginTitle">Member Login</h3>' +
          '<p>Sign in with your slip number and password.</p>' +
          '<form id="memberLoginForm" class="member-form">' +
            '<input type="text" id="memberLoginSlip" placeholder="Slip (e.g. A12)" autocomplete="username" autocapitalize="characters" spellcheck="false" required>' +
            '<input type="password" id="memberLoginPassword" placeholder="Password" autocomplete="current-password" required>' +
            '<div class="member-login-error" id="memberLoginError" hidden></div>' +
            '<button type="submit" class="btn btn-gold">Log In</button>' +
            '<button type="button" class="member-login-textlink" data-go="forgot">Forgot password?</button>' +
          '</form>' +
        '</div>' +
        '<div data-view="forgot" hidden>' +
          '<h3>Reset Password</h3>' +
          '<p>Enter your slip and the email address we have on file. We\'ll email you a link to choose a new password.</p>' +
          '<form id="memberForgotForm" class="member-form">' +
            '<input type="text" id="memberForgotSlip" placeholder="Slip (e.g. A12)" autocapitalize="characters" spellcheck="false" required>' +
            '<input type="email" id="memberForgotEmail" placeholder="Email address" autocomplete="email" required>' +
            '<div class="member-login-error" id="memberForgotError" hidden></div>' +
            '<div class="member-login-note" id="memberForgotDone" hidden></div>' +
            '<button type="submit" class="btn btn-gold">Send Reset Link</button>' +
            '<button type="button" class="member-login-textlink" data-go="login">Back to login</button>' +
          '</form>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    wireModal();
  }

  function showView(name) {
    overlay.querySelectorAll('[data-view]').forEach(function (el) {
      el.hidden = el.getAttribute('data-view') !== name;
    });
    var first = overlay.querySelector('[data-view="' + name + '"] input');
    if (first) first.focus();
  }

  function setBusy(form, busy) {
    var btn = form.querySelector('button[type="submit"]');
    btn.disabled = busy;
    btn.style.opacity = busy ? '0.7' : '';
  }

  function showError(el, msg) {
    el.textContent = msg;
    el.hidden = !msg;
  }

  function wireModal() {
    overlay.querySelector('.member-login-close').addEventListener('click', function () { closeModal(true); });
    overlay.addEventListener('click', function (e) { if (e.target === overlay) closeModal(true); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && overlay.classList.contains('open')) closeModal(true);
    });
    overlay.querySelectorAll('[data-go]').forEach(function (b) {
      b.addEventListener('click', function () {
        if (b.getAttribute('data-go') === 'forgot') {
          document.getElementById('memberForgotSlip').value = document.getElementById('memberLoginSlip').value;
        }
        showView(b.getAttribute('data-go'));
      });
    });

    var loginForm = document.getElementById('memberLoginForm');
    loginForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var slip = normSlip(document.getElementById('memberLoginSlip').value);
      var pwInput = document.getElementById('memberLoginPassword');
      var errorEl = document.getElementById('memberLoginError');
      showError(errorEl, '');
      if (!/^[A-Z0-9-]+$/.test(slip)) { showError(errorEl, 'Please enter a valid slip number.'); return; }
      setBusy(loginForm, true);
      getClient().then(function (sb) {
        return sb.auth.signInWithPassword({ email: slipEmail(slip), password: pwInput.value }).then(function (res) {
          if (res.error) throw new Error('Incorrect slip or password. Please try again.');
          return sb.from('members').select('slip, active').eq('slip', slip).maybeSingle().then(function (m) {
            if (!m.data || !m.data.active) {
              return sb.auth.signOut().then(function () {
                throw new Error('This slip\'s member access is not active. Please contact the marina office.');
              });
            }
            closeModal(false);
            if (document.body.hasAttribute('data-member-portal')) window.location.reload();
            else window.location.href = PORTAL_PAGE;
          });
        });
      }).catch(function (err) {
        showError(errorEl, err.message);
        pwInput.value = '';
        pwInput.focus();
      }).then(function () { setBusy(loginForm, false); });
    });

    var forgotForm = document.getElementById('memberForgotForm');
    forgotForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var slip = normSlip(document.getElementById('memberForgotSlip').value);
      var email = document.getElementById('memberForgotEmail').value.trim();
      var errorEl = document.getElementById('memberForgotError');
      var doneEl = document.getElementById('memberForgotDone');
      showError(errorEl, '');
      doneEl.hidden = true;
      setBusy(forgotForm, true);
      fetch(SUPABASE_URL + '/functions/v1/request-password-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY },
        body: JSON.stringify({ slip: slip, email: email })
      }).then(function (r) {
        return r.json().then(function (body) {
          if (!r.ok) throw new Error(body.error || 'Something went wrong. Please try again.');
          doneEl.textContent = body.message + ' Be sure to check your spam folder. If you no longer have access to that email, please call the marina office.';
          doneEl.hidden = false;
        });
      }).catch(function (err) {
        showError(errorEl, err.message || 'Something went wrong. Please try again.');
      }).then(function () { setBusy(forgotForm, false); });
    });
  }

  function openModal(view) {
    if (!overlay) buildModal();
    overlay.classList.add('open');
    showView(view || 'login');
  }

  function closeModal(returnHome) {
    if (overlay) overlay.classList.remove('open');
    if (returnHome && document.body.hasAttribute('data-member-portal')) {
      getClient().then(function (sb) { return sb.auth.getSession(); }).then(function (r) {
        if (!r.data.session) window.location.href = 'index.html';
      }).catch(function () { window.location.href = 'index.html'; });
    }
  }

  // Shared with member-portal.html and reset-password.html.
  window.MemberAuth = { getClient: getClient, openLogin: openModal, slipEmail: slipEmail };

  document.addEventListener('DOMContentLoaded', function () {
    var trigger = document.getElementById('memberLoginTrigger');
    if (trigger) {
      trigger.addEventListener('click', function (e) {
        e.preventDefault();
        getClient().then(function (sb) { return sb.auth.getSession(); }).then(function (r) {
          if (r.data.session) window.location.href = PORTAL_PAGE;
          else openModal('login');
        }).catch(function () { openModal('login'); });
      });
    }
  });
})();
