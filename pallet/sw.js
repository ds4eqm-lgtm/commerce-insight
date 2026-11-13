/* 바로가기(홈 화면 앱)용. 저장해 두지 않고 늘 인터넷의 최신 화면을 그대로 엽니다 */
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
self.addEventListener('fetch',()=>{});
