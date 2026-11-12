/* Member Portal: shows the signed-in slip's details, password change,
   log out, and (for admin accounts) a searchable member list. */
(function () {
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    MemberAuth.getClient().then(function (sb) {
      return sb.auth.getSession().then(function (r) {
        var session = r.data.session;
        if (!session) {
          $('portalLoading').textContent = 'Please log in to view the member portal.';
          MemberAuth.openLogin('login');
          return;
        }
        return sb.from('members')
          .select('slip, owner_name, email, is_admin, active')
          .eq('user_id', session.user.id)
          .maybeSingle()
          .then(function (res) {
            var m = res.data;
            if (!m || !m.active) {
              return sb.auth.signOut().then(function () {
                $('portalLoading').textContent = 'This slip\'s member access is not active. Please contact the marina office.';
              });
            }
            renderMember(sb, m);
            if (m.is_admin) loadAdmin(sb);
          });
      });
    }).catch(function (err) {
      $('portalLoading').textContent = err.message || 'Something went wrong loading the portal.';
    });
  });

  function renderMember(sb, m) {
    $('portalLoading').hidden = true;
    $('portalMember').hidden = false;
    $('portalWelcome').textContent = 'Welcome, ' + (m.owner_name || 'Member');
    $('portalSlip').textContent = m.slip;
    $('portalOwner').textContent = m.owner_name || '';
    $('portalEmail').textContent = m.email || 'None on file';

    $('portalLogout').addEventListener('click', function () {
      sb.auth.signOut().then(function () { window.location.href = 'index.html'; });
    });
    $('portalShowPw').addEventListener('click', function () {
      $('portalPwCard').hidden = false;
      $('portalPw1').focus();
    });
    $('portalPwForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var p1 = $('portalPw1').value, p2 = $('portalPw2').value;
      var err = $('portalPwError'), done = $('portalPwDone');
      err.hidden = true; done.hidden = true;
      if (p1.length < 8) { err.textContent = 'Please use at least 8 characters.'; err.hidden = false; return; }
      if (p1 !== p2) { err.textContent = 'The two passwords don\'t match.'; err.hidden = false; return; }
      sb.auth.updateUser({ password: p1 }).then(function (res) {
        if (res.error) { err.textContent = res.error.message; err.hidden = false; return; }
        $('portalPwForm').reset();
        done.hidden = false;
      });
    });
  }

  function loadAdmin(sb) {
    Promise.all([
      sb.from('members').select('slip, owner_name, email, active, is_admin').order('slip'),
      sb.from('member_notes').select('slip, note')
    ]).then(function (r) {
      if (r[0].error) return;
      var notes = {};
      (r[1].data || []).forEach(function (n) { notes[n.slip] = n.note; });
      var rows = r[0].data.sort(function (a, b) {
        return a.slip.localeCompare(b.slip, undefined, { numeric: true });
      });
      $('portalAdmin').hidden = false;
      $('adminCount').textContent = rows.length + ' slips on file. To change an owner, email or password, ask your web helper or use the Supabase dashboard.';
      function draw(filter) {
        var f = (filter || '').toLowerCase();
        $('adminRows').innerHTML = rows.filter(function (m) {
          return !f || (m.slip + ' ' + m.owner_name + ' ' + (m.email || '') + ' ' + (notes[m.slip] || '')).toLowerCase().indexOf(f) !== -1;
        }).map(function (m) {
          return '<tr><td><strong>' + esc(m.slip) + '</strong></td><td>' + esc(m.owner_name) +
            (notes[m.slip] ? '<div class="note">' + esc(notes[m.slip]) + '</div>' : '') +
            '</td><td>' + (m.email ? esc(m.email) : '<em>none</em>') + '</td>' +
            '<td class="' + (m.active ? '' : 'inactive') + '">' + (m.is_admin ? 'Admin' : (m.active ? 'Active' : 'Inactive')) + '</td></tr>';
        }).join('');
      }
      draw('');
      $('adminSearch').addEventListener('input', function (e) { draw(e.target.value); });
    });
  }
})();
