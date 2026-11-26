/* Recognize video links and build embedded players.
   Supports YouTube (incl. Shorts), Vimeo, Instagram posts/reels, TikTok and Facebook. */
(function () {
  var NAMES = { youtube: 'YouTube', vimeo: 'Vimeo', instagram: 'Instagram', tiktok: 'TikTok', facebook: 'Facebook', file: 'Video' };

  function parse(raw) {
    var s = String(raw || '').trim();
    if (!s) return { error: 'Please paste a video link.' };
    if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
    var u;
    try { u = new URL(s); } catch (e) { return { error: 'That doesn\'t look like a web link.' }; }
    var host = u.hostname.replace(/^(www|m|mobile)\./, '').toLowerCase();
    var path = u.pathname, m;

    if (host === 'youtu.be') {
      m = path.match(/^\/([\w-]{11})/);
      if (m) return { provider: 'youtube', id: m[1], url: s };
    }
    if (/(^|\.)youtube(-nocookie)?\.com$/.test(host)) {
      var v = u.searchParams.get('v');
      if (v && /^[\w-]{11}$/.test(v)) return { provider: 'youtube', id: v, url: s };
      m = path.match(/^\/(shorts|embed|live|v)\/([\w-]{11})/);
      if (m) return { provider: 'youtube', id: m[2], url: s, vertical: m[1] === 'shorts' };
      return { error: 'That YouTube link doesn\'t point to a single video. Open the video and use Share → Copy link.' };
    }
    if (/(^|\.)vimeo\.com$/.test(host)) {
      m = path.match(/(?:^|\/)(\d{6,})(?:\/|$)/);
      if (m) return { provider: 'vimeo', id: m[1], url: s };
      return { error: 'That Vimeo link doesn\'t include a video number.' };
    }
    if (/(^|\.)instagram\.com$/.test(host)) {
      m = path.match(/^\/(?:[\w.]+\/)?(p|reel|reels|tv)\/([\w-]+)/);
      if (m) return { provider: 'instagram', id: (m[1] === 'reels' ? 'reel' : m[1]) + '/' + m[2], url: s, vertical: m[1] !== 'p' };
      return { error: 'That Instagram link isn\'t a post or reel. Open the post and use Share → Copy link.' };
    }
    if (/(^|\.)tiktok\.com$/.test(host)) {
      m = path.match(/\/video\/(\d+)/);
      if (m) return { provider: 'tiktok', id: m[1], url: s, vertical: true };
      return { error: 'Short TikTok links (vm.tiktok.com) can\'t be used directly. Open the link in a browser, then copy the full address that contains /video/.' };
    }
    if (/(^|\.)(facebook\.com|fb\.watch)$/.test(host)) {
      if (/\/(videos|reel|watch)/.test(path) || u.searchParams.get('v') || host === 'fb.watch') {
        return { provider: 'facebook', id: s, url: s, vertical: /\/reel/.test(path) };
      }
      return { error: 'That Facebook link isn\'t a video.' };
    }
    return { error: 'Only YouTube, Vimeo, Instagram, TikTok and Facebook video links are supported.' };
  }

  function isVertical(v) {
    return v.provider === 'tiktok' || (v.provider === 'instagram' && !/^p\//.test(v.video_id)) ||
      /\/shorts\/|\/reel/.test(v.url || '');
  }

  function embedUrl(v) {
    switch (v.provider) {
      case 'youtube': return 'https://www.youtube-nocookie.com/embed/' + encodeURIComponent(v.video_id) + '?autoplay=1&rel=0&modestbranding=1';
      case 'vimeo': return 'https://player.vimeo.com/video/' + encodeURIComponent(v.video_id) + '?autoplay=1';
      case 'instagram': return 'https://www.instagram.com/' + v.video_id + '/embed';
      case 'tiktok': return 'https://www.tiktok.com/embed/v2/' + encodeURIComponent(v.video_id);
      case 'facebook': return 'https://www.facebook.com/plugins/video.php?show_text=false&autoplay=1&href=' + encodeURIComponent(v.video_id);
    }
    return '';
  }

  function thumbUrl(v) {
    return v.provider === 'youtube' ? 'https://img.youtube.com/vi/' + encodeURIComponent(v.video_id) + '/hqdefault.jpg' : '';
  }

  window.VideoUtils = { parse: parse, embedUrl: embedUrl, thumbUrl: thumbUrl, isVertical: isVertical, name: function (p) { return NAMES[p] || p; } };
})();
