// 한솔빌트인 E-Catalog 서비스 워커
// 앱을 "설치(홈 화면에 추가)" 가능하게 하고, 한 번 열어본 파일들은 오프라인에서도 그대로 열리게 해줍니다.
//
// 중요: 캐시 이름에 버전 번호를 포함시킵니다. 이렇게 해야 새 버전을 배포했을 때
// 사용자의 휴대폰/브라우저에 남아있는 "예전 캐시"가 자동으로 정리되고 새 파일로
// 교체됩니다. (버전 번호가 고정되어 있으면, 아무리 새 버전을 올려도 사용자 기기에는
// 처음 설치했을 때의 예전 파일이 계속 남아서 계속 옛날 화면만 보이는 문제가 있었습니다.)
// -> 새 버전을 배포할 때마다 이 숫자를 반드시 올려주세요.
const CACHE_NAME = 'hansol-ecatalog-v3.10';

self.addEventListener('install', function (event) {
    self.skipWaiting();
});

self.addEventListener('activate', function (event) {
    event.waitUntil(
        caches.keys().then(function (names) {
            return Promise.all(
                names.filter(function (n) { return n !== CACHE_NAME; })
                     .map(function (n) { return caches.delete(n); })
            );
        }).then(function () { return self.clients.claim(); })
    );
});

// 네트워크 우선(network-first) 전략으로 변경: 항상 먼저 최신 파일을 네트워크에서
// 받아오려고 시도하고, 성공하면 캐시도 갱신합니다. 네트워크를 못 쓸 때(오프라인)만
// 캐시에 있는 이전 파일로 대신 보여줍니다. (기존의 "캐시 우선" 방식은 한 번 저장된
// 파일을 계속 우선 사용해서, 새 버전을 올려도 계속 예전 화면이 보이는 원인이었습니다.)
self.addEventListener('fetch', function (event) {
    if (event.request.method !== 'GET') return;
    event.respondWith(
        fetch(event.request).then(function (response) {
            if (response && response.status === 200) {
                var copy = response.clone();
                caches.open(CACHE_NAME).then(function (cache) {
                    cache.put(event.request, copy);
                });
            }
            return response;
        }).catch(function () {
            return caches.match(event.request);
        })
    );
});
