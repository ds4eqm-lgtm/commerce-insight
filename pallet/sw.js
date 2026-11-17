/* 바탕화면 바로가기(설치 앱)용 ver 0.23. 저장해 두지 않고 늘 인터넷의 최신 화면을 그대로 엽니다 */
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
self.addEventListener('fetch',e=>{if(e.request.mode==='navigate')e.respondWith(fetch(e.request))});
