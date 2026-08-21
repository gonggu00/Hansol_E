
// data.js 에서 TOTAL_PAGES, LAST_LABEL_NUM, CATEGORIES, CONTENTS 를 미리 로드합니다.

const FIRST_VISIBLE_PAGE = 2; // 책을 열면 바로 이 페이지(내지 1p)부터 시작
var bookInitialized = false;
var jumpReturnPage = null; // 메뉴/색인 클릭으로 멀리 이동했을 때, "이동 전 화면"으로 되돌아가기 위한 기록

document.getElementById('cover-img').src = 'images/cover.webp';

$(function(){
    // 표지 화면 크기를 처음부터 책(펼침면)과 동일한 크기로 맞춤

    // 영상 모달 닫기 버튼 및 배경 클릭 시 닫기
    $('#video-modal-close').on('click', function(){ closeVideoModal(); });
    setupVideoControls();
    $('#video-modal-unmute').on('click', function(){
        var player = document.getElementById('video-modal-player');
        if (player) { player.muted = false; player.play().catch(function(){}); }
        $(this).attr('hidden', 'hidden');
    });
    // PC(데스크탑)에서는 Esc키로도 영상창을 닫을 수 있게 함
    $(document).on('keydown', function(ev){
        if (ev.key === 'Escape' && $('#video-modal').attr('hidden') === undefined) closeVideoModal();
    });
    $('#video-modal').on('click', function(ev){
        if (ev.target === this) closeVideoModal(); // 영상 바깥(어두운 배경)을 눌러도 닫힘
    });

    try { resizeCoverToMatchBook(); } catch (err) { /* 무시 */ }

    // 창 크기 조절/화면 확대·축소/기기 회전은 책을 열기 전(표지 화면)부터 항상 감지합니다.
    // resize 이벤트 하나만 믿으면 실제 기기에서 몇 가지 문제가 있었습니다:
    // 1) 일부 모바일 브라우저는 화면을 "회전"할 때 resize가 늦게 오거나 정확한
    //    새 크기가 반영되기 전에 먼저 오는 경우가 있어서, orientationchange
    //    이벤트도 함께 감지해서 한 번 더 재계산합니다.
    // 2) 모바일 브라우저(특히 크롬)는 스크롤에 따라 주소창이 나타났다 사라졌다
    //    하면서 실제 보이는 화면 높이(innerHeight)가 수시로 바뀌는데, 이 변화는
    //    resize 이벤트로 잘 안 잡히는 경우가 많습니다. 이를 위해 지원하는 기기에서는
    //    visualViewport의 resize/scroll도 함께 감지합니다.
    $(window).on('resize', scheduleResize);
    $(window).on('orientationchange', function(){
        // 회전 애니메이션이 끝나고 실제 새 크기가 자리잡을 시간을 살짝 준 뒤 재계산합니다.
        setTimeout(scheduleResize, 50);
        setTimeout(scheduleResize, 300);
        setTimeout(scheduleResize, 600);
    });
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', scheduleResize);
        window.visualViewport.addEventListener('scroll', scheduleResize);
    }
    // 페이지를 처음 열었을 때, 모바일 브라우저의 주소창/도구모음이 자리잡기 전
    // 순간의 크기로 계산되었을 가능성에 대비해 잠시 후 한 번 더 재계산합니다.
    setTimeout(scheduleResize, 400);
    setTimeout(scheduleResize, 1000);
});

if (typeof jQuery === 'undefined' || typeof jQuery.fn.turn === 'undefined') {
    document.addEventListener('DOMContentLoaded', function() {
        document.body.innerHTML =
            '<div style="color:#fff;font-family:sans-serif;text-align:center;padding-top:40vh;">' +
            '<h2>플립북을 불러오지 못했습니다</h2>' +
            '<p style="margin-top:10px;color:#ccc;">jQuery / turn.js 로드에 실패했습니다. lib 폴더가 함께 있는지 확인해주세요.</p>' +
            '</div>';
    });
}

// turn.js 페이지 번호(t) -> 실제 이미지 파일 경로. t=1(더미)은 이미지가 필요 없습니다.
function pagePathForTurn(t) {
    if (t <= 1) return null;
    var k = t - 1; // 내지 PDF 페이지 번호 (1-based)
    var padded = ('000' + k).slice(-3);
    return 'images/page-' + padded + '.webp';
}

// ============================================================
// 이미지 우선순위 프리로딩 - 현재 페이지 근처부터 먼저 불러와서
// 페이지를 넘길 때 하얗게 비어보이는 현상(버퍼링)을 없앱니다.
// ============================================================
var _preloadedPages = {};   // t(turn 페이지번호) -> true
var _preloadedImages = {};  // t -> Image 객체 (GC로 사라지지 않게 붙잡아둠)
var _idlePreloadQueued = false;

function _preloadOnePage(t) {
    if (_preloadedPages[t]) return;
    var path = pagePathForTurn(t);
    if (!path) return;
    _preloadedPages[t] = true;
    var img = new Image();
    img.decoding = 'async';
    img.src = path;
    if (img.decode) {
        img.decode().catch(function(){ /* 디코드 실패는 무시 - 어차피 background-image로도 로드됨 */ });
    }
    _preloadedImages[t] = img;
}

// centerT를 기준으로 앞뒤 radius 페이지를 즉시(최우선) 프리로드합니다.
// 페이지를 펼침면(2페이지)으로 보여주므로 항상 짝을 함께 불러옵니다.
function preloadAround(centerT, radius) {
    for (var d = -radius; d <= radius; d++) {
        _preloadOnePage(centerT + d);
    }
}

// 나머지 전체 페이지를 화면이 한가할 때(requestIdleCallback) 순서대로
// 조금씩 백그라운드에서 미리 불러옵니다. 사용자가 빠르게 여러 장 넘겨도
// 이미 캐시에 있을 확률이 높아집니다.
function idlePreloadRemaining(centerT) {
    if (_idlePreloadQueued) return;
    _idlePreloadQueued = true;

    var order = [];
    for (var d = 1; d <= TOTAL_PAGES; d++) {
        if (centerT + d <= TOTAL_PAGES) order.push(centerT + d);
        if (centerT - d >= 1) order.push(centerT - d);
    }

    var idx = 0;
    function step(deadline) {
        var budget = (deadline && deadline.timeRemaining) ? deadline : { timeRemaining: function(){ return 8; } };
        while (idx < order.length && budget.timeRemaining() > 0) {
            _preloadOnePage(order[idx]);
            idx++;
        }
        if (idx < order.length) {
            _scheduleIdle(step);
        }
    }
    _scheduleIdle(step);
}

function _scheduleIdle(fn) {
    if (window.requestIdleCallback) {
        window.requestIdleCallback(fn, { timeout: 1000 });
    } else {
        setTimeout(function(){ fn(null); }, 200);
    }
}


function openBook() {
    if (typeof jQuery === 'undefined' || typeof jQuery.fn.turn === 'undefined') return;

    if (!bookInitialized) {
        bookInitialized = true;

        // 주의: turn.js는 현재 보이는 페이지 근처만 DOM에 유지하고 나머지는 내부적으로
        // 제거/재생성합니다. 그래서 나중에 jQuery로 특정 페이지 DOM을 찾아 배경 이미지를
        // "나중에" 넣는 지연로딩 방식은 turn.js와 충돌해 페이지가 안 보이는 문제가
        // 있었습니다. 로컬 파일(디스크)이라 로딩이 빠르므로, 처음부터 모든 페이지의
        // 이미지 경로를 지정해서 이 문제를 근본적으로 해결합니다.
        var pagesHtml = '';
        for (var i = 0; i < TOTAL_PAGES; i++) {
            var t = i + 1;
            var path = pagePathForTurn(t);
            pagesHtml += path
                ? '<div class="page" style="background-image:url(\'' + path + '\');"></div>'
                : '<div class="page"></div>';
        }
        $('#flipbook').html(pagesHtml);

        // 현재 보이는 펼침면 근처를 최우선으로 즉시 프리로드, 나머지는 한가할 때 백그라운드로
        preloadAround(FIRST_VISIBLE_PAGE, 4);
        idlePreloadRemaining(FIRST_VISIBLE_PAGE);


        // 중요: #viewport 는 아직 display:none 상태입니다. turn.js 초기화와 크기 조정을
        // 화면에 보이지 않는 상태에서 전부 끝낸 뒤에 한 번에 보여줘서, 초기화 도중의
        // "빈 배경 + 흰 페이지" 깨진 화면이 잠깐 보이는 문제를 근본적으로 막습니다.
        $('#flipbook').turn({
            width: 1508,
            height: 820,
            autoCenter: true,
            display: 'double',
            acceleration: true,
            gradients: true,
            elevation: 100,
            duration: 700,
            page: FIRST_VISIBLE_PAGE,
            when: {
                turning: function(event, page) {
                    try { preloadAround(page, 3); } catch (err) { /* 무시 */ }
                },
                turned: function(event, page) {
                    try {
                        updatePageNumber(page);
                        updateArrowState(page);
                        refreshMemoDots();
                        var $fbEl = $('#flipbook')[0];
                        if ($fbEl) {
                            var turnedRect = $fbEl.getBoundingClientRect();
                            renderHotspots(turnedRect);
                            renderVideoHotspots(turnedRect);
                        }
                    } catch (err) { /* 안전하게 무시하고 진행 */ }
                }
            }
        });

        resizeFlipbook();
        updatePageNumber(FIRST_VISIBLE_PAGE);
        updateArrowState(FIRST_VISIBLE_PAGE);
        refreshMemoDots();
        setupMemoDotDragging();
        setupPanelDragging();
        setupEdgeClickZones();
        setupContentListDelegation();

        $(document).on('keydown', function(e) {
            if (e.key === 'ArrowLeft') flipPrev();
            if (e.key === 'ArrowRight') flipNext();
            if (e.key === 'Escape') closePanel();
        });

        // 브라우저가 위 크기/배치를 실제로 한 번 반영(레이아웃)할 시간을 준 뒤에
        // 화면을 보여줍니다 (rAF 2회 = 최소 1프레임 이상 보장).
        requestAnimationFrame(function(){
            requestAnimationFrame(revealBookUI);
        });
    } else {
        resizeFlipbook();
        revealBookUI();
    }
}

function revealBookUI() {
    $('#cover-screen').addClass('fade-out');
    $('#top-bar').show();
    $('#viewport').show();
    $('#arrow-prev').show();
    $('#arrow-next').show();
    $('#bottombar').show();
    // 뷰포트가 화면에 실제로 보이게 된 "이후"에 그림자/책두께 위치를 다시 계산합니다.
    // display:none 상태에서 계산하면 크기가 0으로 측정되어 그림자가 사라진 채로
    // 보이는 문제가 있었습니다 (다음 리사이즈/페이지 넘김 전까지 계속 안 보임).
    requestAnimationFrame(function(){
        resizeFlipbook();
    });
}

function flashPressed(id) {
    var $el = $(id);
    $el.addClass('pressed');
    setTimeout(function(){ $el.removeClass('pressed'); }, 260);
}

function flipNext() {
    jumpReturnPage = null;
    flashPressed('#arrow-next');
    $('#flipbook').turn('next');
}
function flipPrev() {
    flashPressed('#arrow-prev');
    if (jumpReturnPage != null) {
        var target = jumpReturnPage;
        jumpReturnPage = null;
        goToPage(target, true);
        return;
    }
    var p = $('#flipbook').turn('page');
    if (p <= FIRST_VISIBLE_PAGE) {
        closeBook();
    } else {
        $('#flipbook').turn('previous');
    }
}

function goToFirstSpread() { goToPage(FIRST_VISIBLE_PAGE); }
function goToLastSpread() { goToPage(TOTAL_PAGES); }

function closeBook() {
    $('#top-bar').hide();
    $('#arrow-prev').hide();
    $('#arrow-next').hide();
    $('#bottombar').hide();
    $('#cover-screen').removeClass('fade-out');
}

function updateArrowState(page) {
    $('#arrow-prev').toggleClass('disabled', false); // 이전으로 계속 가면 표지로 복귀
    $('#arrow-next').toggleClass('disabled', page >= TOTAL_PAGES);
}

// 책 왼쪽/오른쪽 바깥 가장자리를 클릭해도 페이지가 넘어가게 함
// 가장자리 클릭으로 페이지 넘기기 + 좌우로 드래그해서 페이지 넘기기, 두 가지 방식을
// 모두 지원합니다. 짧게 눌렀다 떼면(움직임이 거의 없으면) 클릭으로 처리하고,
// 일정 거리 이상 좌우로 끌면(드래그) 그 방향에 맞춰 페이지를 넘깁니다.
function setupEdgeClickZones() {
    function bindTapAndSwipe($el, onTap) {
        var startX = 0, startY = 0, tracking = false, moved = false;
        var SWIPE_THRESHOLD = 40, TAP_THRESHOLD = 10;

        function point(e) {
            if (e.touches && e.touches.length) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
            if (e.changedTouches && e.changedTouches.length) return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
            return { x: e.clientX, y: e.clientY };
        }

        $el.on('mousedown touchstart', function(e){
            var p = point(e.originalEvent || e);
            startX = p.x; startY = p.y; tracking = true; moved = false;
        });
        $el.on('mousemove touchmove', function(e){
            if (!tracking) return;
            var p = point(e.originalEvent || e);
            if (Math.abs(p.x - startX) > TAP_THRESHOLD || Math.abs(p.y - startY) > TAP_THRESHOLD) moved = true;
        });
        $el.on('mouseup touchend', function(e){
            if (!tracking) return;
            tracking = false;
            var p = point(e.originalEvent || e);
            var dx = p.x - startX;
            if (Math.abs(dx) >= SWIPE_THRESHOLD) {
                // 왼쪽으로 끌면 다음 페이지, 오른쪽으로 끌면 이전 페이지 (책장을 넘기는 손동작과 동일)
                if (dx < 0) flipNext(); else flipPrev();
            } else if (!moved) {
                onTap();
            }
        });
        $el.on('mouseleave', function(){ tracking = false; });
    }

    bindTapAndSwipe($('#edge-zone-left'), function(){ flipPrev(); });
    bindTapAndSwipe($('#edge-zone-right'), function(){ flipNext(); });
}

// 색인 페이지의 "제품명 + 사진" 영역을 클릭하면 해당 제품 페이지로 이동합니다.
// 좌우 넘기기 버튼(#arrow-prev/#arrow-next)과 하단 기능박스(#bottombar)를
// "브라우저 창 가장자리"가 아니라 "책의 실제 가장자리"를 기준으로 위치시켜서,
// 화면 크기/비율이 바뀌어도 책과의 간격이 항상 일정한 비율로 유지되게 합니다.
// (기존에는 창 크기 기준으로 고정돼 있어서, 비율이 바뀌면 버튼이 책과 멀어지거나
//  책 위에 겹쳐 보이는 등 위치가 들쭉날쭉했던 문제를 해결합니다.)
function positionNavControls(rect) {
    if (!rect || !rect.width || !rect.height) return;

    var $prev = $('#arrow-prev');
    var $next = $('#arrow-next');
    var $bottom = $('#bottombar');
    if (!$prev.length || !$next.length || !$bottom.length) return;

    // 책 크기에 비례하는 간격 (너무 작거나 크지 않도록 최소/최대값으로 안전하게 제한)
    var gapH = Math.max(8, Math.min(rect.width * 0.03, 50));
    var gapV = Math.max(8, Math.min(rect.height * 0.03, 34));

    var arrowW = $prev.outerWidth() || 60;
    var leftPos = Math.max(6, rect.left - gapH - arrowW);
    var rightPos = Math.max(6, window.innerWidth - (rect.left + rect.width) - gapH - arrowW);
    $prev.css('left', leftPos + 'px');
    $next.css('right', rightPos + 'px');

    var barH = $bottom.outerHeight() || 60;
    var bottomPos = Math.max(6, window.innerHeight - (rect.top + rect.height) - gapV - barH);
    $bottom.css('bottom', bottomPos + 'px');

    // 상단 페이지표시+확대버튼 배지: 책 상단 가장자리 기준으로 위치 계산
    // (화면 중앙 고정이 아니라, 책이 어디 있든 책 상단에서 항상 같은 비율 간격 유지)
    var $topBadge = $('#top-page-indicator-center');
    if ($topBadge.length) {
        var badgeGapV = Math.max(6, Math.min(rect.height * 0.018, 22));
        var badgeH = $topBadge.outerHeight() || 32;
        var badgeW = $topBadge.outerWidth() || 100;
        var topPos = Math.max(4, rect.top - badgeGapV - badgeH);
        var leftPos2 = rect.left + rect.width / 2 - badgeW / 2;
        leftPos2 = Math.max(4, Math.min(leftPos2, window.innerWidth - badgeW - 4));
        $topBadge.css({ top: topPos + 'px', left: leftPos2 + 'px' });
    }
}

function renderHotspots(rect) {
    var $layer = $('#hotspot-layer').empty();
    if (!rect || !rect.width || !rect.height || !HOTSPOTS.length) return;
    if (!bookInitialized) return;

    var view;
    try { view = $('#flipbook').turn('view'); } catch (err) { return; }
    var leftPage, rightPage;
    if (view && view.length === 2) { leftPage = view[0]; rightPage = view[1]; }
    else {
        try { leftPage = rightPage = $('#flipbook').turn('page'); } catch (err) { return; }
    }

    var single = (currentDisplayMode === 'single');
    var pageW = single ? rect.width : rect.width / 2;

    HOTSPOTS.forEach(function(hs) {
        var isLeft = hs.turnPage === leftPage;
        var isRight = hs.turnPage === rightPage;
        if (!isLeft && !isRight) return;
        var baseX = rect.left + ((single || isLeft) ? 0 : pageW);
        var x = baseX + (hs.x / 100) * pageW;
        var y = rect.top + (hs.y / 100) * rect.height;
        var w = (hs.w / 100) * pageW;
        var h = (hs.h / 100) * rect.height;
        $('<div class="hotspot"></div>')
            .addClass(hs.type === 'photo' ? 'hotspot-photo' : 'hotspot-text')
            .attr('title', hs.name + ' 페이지로 이동')
            .css({ left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' })
            .on('click', function(){
                var $this = $(this);
                if ($this.hasClass('selected')) return; // 중복 클릭 방지
                $layer.find('.hotspot').removeClass('selected');
                $this.addClass('selected');
                var target = hs.targetPage;
                setTimeout(function(){ goToPage(target); }, 160);
            })
            .appendTo($layer);
    });
}

// "영상 보기" 위치에 재생 버튼 배지를 표시하고, 누르면 영상 모달을 엽니다.
// 기존 renderHotspots와 완전히 분리되어 있어 기존 클릭 이동 기능에는
// 영향을 주지 않습니다.
function renderVideoHotspots(rect) {
    var $layer = $('#video-hotspot-layer').empty();
    if (!rect || !rect.width || !rect.height) return;
    if (typeof VIDEO_HOTSPOTS === 'undefined' || !VIDEO_HOTSPOTS.length) return;
    if (!bookInitialized) return;

    var view;
    try { view = $('#flipbook').turn('view'); } catch (err) { return; }
    var leftPage, rightPage;
    if (view && view.length === 2) { leftPage = view[0]; rightPage = view[1]; }
    else {
        try { leftPage = rightPage = $('#flipbook').turn('page'); } catch (err) { return; }
    }

    var single = (currentDisplayMode === 'single');
    var pageW = single ? rect.width : rect.width / 2;

    VIDEO_HOTSPOTS.forEach(function(vh) {
        var isLeft = vh.turnPage === leftPage;
        var isRight = vh.turnPage === rightPage;
        if (!isLeft && !isRight) return;
        var baseX = rect.left + ((single || isLeft) ? 0 : pageW);
        var x = baseX + (vh.x / 100) * pageW;
        var y = rect.top + (vh.y / 100) * rect.height;
        var w = (vh.w / 100) * pageW;
        var h = (vh.h / 100) * rect.height;
        // 화면이 좁을 때는 "영상보기" 대신 짧게 "영상"만 표시 (좁은 화면에서 글자가 안 잘리도록)
        var label = window.innerWidth <= 700 ? '영상' : '영상보기';
        var $badge = $('<div class="video-play-badge"></div>');
        if (vh.badgeOnly) $badge.addClass('badge-only'); // 테두리 없이 펄스 배지만 표시(사진 전체를 감싸지 않는 경우)
        $badge
            .attr('data-label', label)
            .attr('title', vh.name + ' 영상 보기')
            .css({ left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' })
            .on('click', function(ev){
                ev.stopPropagation(); // 아래에 겹쳐있는 기존 클릭(페이지 이동)이 같이 실행되지 않도록 막음
                openVideoModal(vh.video, vh.name);
            })
            .appendTo($layer);
    });
}

// 영상 모달을 열고 자동재생합니다.
// - 소리와 함께 자동재생이 막히는 기기/브라우저에서는 무음으로라도 자동재생하고
//   "소리 켜기" 버튼을 보여줍니다 (플랫폼마다 자동재생 정책이 달라서 필요한 처리).
// - 안드로이드 폰의 "뒤로가기"를 누르면 앱이 꺼지거나 페이지 이동하는 대신
//   이 영상창만 닫히도록, 히스토리에 임시 기록을 하나 남겨둡니다.
function handleVideoModalPopstate() {
    closeVideoModal(true);
}
function openVideoModal(src, title) {
    var $modal = $('#video-modal');
    var player = document.getElementById('video-modal-player');
    if (!$modal.length || !player) return;
    player.muted = false;
    $('#video-modal-unmute').attr('hidden', 'hidden');
    $('#video-modal-error').attr('hidden', 'hidden'); // 이전 에러 메시지 있으면 초기화
    player.src = src;
    $modal.attr('aria-label', title || '영상').removeAttr('hidden');

    try { history.pushState({ hansolVideoModal: true }, ''); } catch (err) { /* 무시 */ }
    window.addEventListener('popstate', handleVideoModalPopstate);

    // 영상 파일을 못 찾거나 재생할 수 없을 때, 조용히 실패하지 않고
    // 화면에 바로 원인을 보여줘서 나중에 문제 파악이 쉽도록 함
    player.onerror = function(){
        $('#video-modal-error').text('영상을 불러올 수 없습니다. (경로: ' + src + ')').removeAttr('hidden');
    };

    var playPromise = player.play();
    if (playPromise && playPromise.catch) {
        playPromise.catch(function(){
            // 소리 켜진 자동재생이 막힌 경우: 무음으로라도 자동재생 시도 + 소리 켜기 버튼 노출
            player.muted = true;
            $('#video-modal-unmute').removeAttr('hidden');
            player.play().catch(function(){ /* 그래도 안 되면 사용자가 재생버튼을 직접 누르면 됨 */ });
        });
    }
}

// 영상 모달을 닫고 재생을 완전히 멈춥니다(모바일에서 배경 재생 방지).
// fromPopstate가 true면 "뒤로가기로 이미 히스토리가 넘어간 상태"이므로
// 다시 history.back()을 호출하지 않습니다 (중복 호출 방지).
function closeVideoModal(fromPopstate) {
    var $modal = $('#video-modal');
    var player = document.getElementById('video-modal-player');
    if (!$modal.length || !player) return;
    if ($modal.attr('hidden') !== undefined) return; // 이미 닫혀있으면 중복 처리 방지

    player.pause();
    player.removeAttribute('src');
    player.load();
    $modal.attr('hidden', 'hidden');
    window.removeEventListener('popstate', handleVideoModalPopstate);

    if (!fromPopstate) {
        try { history.back(); } catch (err) { /* 무시 */ } // 열 때 추가했던 히스토리 기록을 정리
    }
}

// 커스텀 컨트롤바(뒤로3초/재생·정지/앞으로3초/드래그 진행바)를 영상 요소에 연결합니다.
// 페이지 로드 시 한 번만 연결하며, 이후에는 열려있는 영상 하나에 계속 적용됩니다.
function setupVideoControls() {
    var player = document.getElementById('video-modal-player');
    var $progress = $('#video-progress');
    var $playBtn = $('#video-btn-playpause');
    if (!player || !$progress.length || !$playBtn.length) return;

    var isSeeking = false; // 사용자가 진행바를 드래그하는 동안에는 재생시간 자동갱신을 잠시 멈춤

    function syncPlayIcon() {
        if (player.paused) {
            $playBtn.addClass('is-paused').removeClass('is-playing').attr('aria-label', '재생');
        } else {
            $playBtn.removeClass('is-paused').addClass('is-playing').attr('aria-label', '일시정지');
        }
    }

    player.addEventListener('play', syncPlayIcon);
    player.addEventListener('pause', syncPlayIcon);

    player.addEventListener('timeupdate', function(){
        if (isSeeking || !player.duration) return;
        $progress.val((player.currentTime / player.duration) * 100);
    });
    player.addEventListener('loadedmetadata', function(){
        $progress.val(0);
        syncPlayIcon();
    });

    $progress.on('input', function(){ isSeeking = true; }); // 드래그 시작
    $progress.on('change', function(){
        if (player.duration) {
            player.currentTime = (parseFloat($progress.val()) / 100) * player.duration;
        }
        isSeeking = false; // 드래그 끝나면 다시 자동갱신 재개
    });

    $playBtn.on('click', function(){
        if (player.paused) player.play().catch(function(){});
        else player.pause();
    });
    $('#video-btn-rewind').on('click', function(){
        player.currentTime = Math.max(0, player.currentTime - 3);
    });
    $('#video-btn-forward').on('click', function(){
        if (player.duration) player.currentTime = Math.min(player.duration, player.currentTime + 3);
        else player.currentTime = player.currentTime + 3;
    });
}

// 내지 페이지 실제 비율 (1123 x 1221) 기준 - 2페이지 스프레드
var PAGE_RATIO = 1123 / 1221;
var SPREAD_RATIO = PAGE_RATIO * 2;

// 창 크기 조절/화면 확대·축소가 연속으로 여러 번 발생해도 turn.js 재배치가
// 한 번에 몰리지 않도록 디바운스 처리 (연속 호출 시 화면이 갈라지거나
// 멈추는 현상 방지)
var resizeDebounceTimer = null;
function scheduleResize() {
    clearTimeout(resizeDebounceTimer);
    resizeDebounceTimer = setTimeout(function(){
        try { resizeFlipbook(); } catch (err) { /* 안전하게 무시 */ }
        try { resizeCoverToMatchBook(); } catch (err) { /* 안전하게 무시 */ }
    }, 150);
}

// 표지 화면과 실제 책(펼침면)이 항상 "정확히 같은 크기"로 보이도록,
// 두 화면이 동일한 계산식을 공유합니다 (화면 확대/축소 시에도 항상 일치).
// iPhone 등 노치/하단 홈 인디케이터가 있는 기기에서 실제 안전 영역만큼을 읽어옵니다.
// (CSS의 env(safe-area-inset-*)와 동일한 값을 JS에서도 알아야, 하단 메뉴바가
// 안전 영역만큼 더 밀려 올라간 상황에서도 책 크기 계산이 그 여백까지 정확히
// 반영해서, 겹치지 않게 안정적으로 맞출 수 있습니다.)
function safeAreaInset(side) {
    try {
        var probe = document.createElement('div');
        probe.style.position = 'fixed';
        probe.style.top = '0'; probe.style.left = '0';
        probe.style.visibility = 'hidden';
        probe.style.paddingBottom = 'env(safe-area-inset-' + side + ', 0px)';
        document.body.appendChild(probe);
        var val = parseFloat(getComputedStyle(probe).paddingBottom) || 0;
        document.body.removeChild(probe);
        return val;
    } catch (err) {
        return 0;
    }
}

function computeBookSize() {
    var mobile = isMobileViewport();
    var maxW = window.innerWidth * (mobile ? 0.94 : 0.86);
    // 모바일: 상단바를 완전히 숨겼으므로 위쪽 여유는 최소한만, 대신 하단
    // 메뉴바(패딩/여백 포함 약 72px)와 겹치지 않도록 충분히 여유를 둡니다.
    // 노치/홈 인디케이터가 있는 기기는 그만큼 안전 영역을 추가로 확보합니다.
    var safeBottom = mobile ? safeAreaInset('bottom') : 0;
    var safeTop = mobile ? 0 : safeAreaInset('top');
    var reserved = 110 + safeBottom + safeTop;
    var maxH = (window.innerHeight - reserved) * 0.92;

    function fit(ratio) {
        var w = maxW, h = w / ratio;
        if (h > maxH) { h = maxH; w = h * ratio; }
        return { width: w, height: h };
    }

    // 1페이지/2페이지 중 무엇으로 보여줄지는 화면 방향이나 기기 종류가 아니라,
    // "2페이지로 보여줄 때 각 페이지 크기가 1페이지로 볼 때에 비해 얼마나 작아지는지"로
    // 판단합니다. 전체 면적을 비교하면 정사각형에 가까운 1페이지 모양이 원래 면적이
    // 더 커서 항상 1페이지 쪽으로 치우치는 문제가 있었습니다 - 실제로 중요한 건
    // "각 페이지가 읽기에 충분히 큰가"이므로 페이지 1장의 폭을 직접 비교합니다.
    // 세로/가로 폭 비율에만 의존하는 순수 기하학적 계산이라, 화면 크기나 기종이
    // 달라져도(휴대폰/태블릿, 어떤 해상도든) 항상 같은 기준으로 안정적으로 동작합니다.
    // 화면이 아무리 좁고 길어져도 책은 항상 "2페이지 펼침면" 형태를 그대로
    // 유지합니다. 대신 화면에 맞춰 전체 크기만 작아지면서 위아래(또는 좌우)에
    // 자연스러운 여백이 생기도록 합니다 (마치 세로 화면으로 가로 영화를 볼 때
    // 위아래에 여백이 생기는 것과 같은 원리). 이렇게 해야 화면 비율이 어떻게
    // 바뀌어도 카탈로그 특유의 "책을 펼친 모습"이 항상 그대로 유지됩니다.
    var chosen = fit(SPREAD_RATIO);

    return { width: chosen.width, height: chosen.height, mobile: mobile, wantDouble: true };
}

// 표지와 책(내지)은 항상 정확히 같은 크기여야 합니다 (다르면 표지->내지로
// 전환될 때 크기가 갑자기 바뀌면서 두 화면이 잠깐 겹쳐 보이는 문제가 생깁니다).
// 그래서 표지 크기는 별도로 계산하지 않고, 책 크기를 계산하는 함수의 결과를
// 그대로 가져다 씁니다. (표지 이미지는 펼침면 형태라, 책이 1페이지 모드를
// 선택하는 좁은 화면에서는 표지 이미지의 양 옆이 약간 잘릴 수 있지만, 그
// 상황에서는 내지도 이미 1페이지씩만 보여주고 있으므로 자연스럽게 어울리고,
// 무엇보다 표지와 책 크기가 달라서 화면이 겹쳐 보이는 훨씬 눈에 띄는 문제를
// 막을 수 있습니다.)
function computeCoverSize() {
    var size = computeBookSize();
    return { width: size.width, height: size.height };
}

// 화살표 버튼, 하단 메뉴바 등 "책 주변 UI"가 책 크기와 무관하게 항상 고정된
// 픽셀 크기였던 탓에, 창 크기에 따라 책은 작아지는데 주변 UI는 그대로라서
// 전체적인 화면 구성(간격/비율/배치)이 창 크기마다 달라 보이는 문제가
// 있었습니다. 책 폭을 기준으로 UI 배율을 계산해서 CSS 변수로 반영하면,
// 화살표/하단바가 책 크기에 비례해서 항상 같은 "느낌"의 구성으로 보입니다.
// (너무 작아지거나(터치하기 힘듦) 너무 커지지 않도록 배율 범위를 제한합니다.)
var UI_SCALE_REFERENCE_WIDTH = 1200;
function applyUIScale(bookWidth) {
    // 배율 자체는 넓은 범위로 허용해서 책 크기 변화를 최대한 정확하게(비례적으로)
    // 따라가게 합니다. "너무 작아지면 누르기 힘들다"는 문제는 아래 CSS에서
    // clamp()로 각 요소의 "실제 최소 픽셀 크기"를 보장하는 방식으로 따로
    // 처리합니다 (배율 자체를 일찍 멈추면, 책은 계속 작아지는데 화살표/메뉴바만
    // 먼저 멈춰서 오히려 상대적으로 커 보이는 문제가 있었습니다).
    var scale = bookWidth / UI_SCALE_REFERENCE_WIDTH;
    scale = Math.max(0.28, Math.min(1.3, scale));
    document.documentElement.style.setProperty('--ui-scale', scale);
}

function resizeCoverToMatchBook() {
    var size = computeCoverSize();
    $('.cover-frame').css({ width: size.width + 'px', height: size.height + 'px' });
    applyUIScale(size.width);
}

function resizeFlipbook() {
    if (!bookInitialized) return;

    var size = computeBookSize();
    applyUIScale(size.width);
    var wantDisplay = size.wantDouble ? 'double' : 'single';
    if (wantDisplay !== currentDisplayMode) {
        $('#flipbook').turn('display', wantDisplay);
        currentDisplayMode = wantDisplay;
    }

    $('#flipbook').turn('size', size.width, size.height);
    positionShadows();
    if (bookInitialized) refreshMemoDots();
}

function positionShadows() {
    var $fb = $('#flipbook');
    if (!$fb.length) return;
    var rect = $fb[0].getBoundingClientRect();

    renderHotspots(rect);
    renderVideoHotspots(rect);
    positionNavControls(rect);

    $('#book-ambient-shadow').css({
        left: rect.left - rect.width * 0.10,
        top: rect.top - rect.height * 0.08,
        width: rect.width * 1.20,
        height: rect.height * 1.22
    });

    // 책 바로 바깥 테두리 그림자 (상/좌/우/하 전부 - 배경과 책을 뚜렷하게 분리)
    $('#book-frame-shadow').css({
        left: rect.left - 3,
        top: rect.top - 3,
        width: rect.width + 6,
        height: rect.height + 6
    });

    // 배경 -> 책 그림자 (책 아래쪽, 배경과 책을 분리해주는 메인 그림자)
    $('#book-floor-shadow').css({
        left: rect.left + rect.width * 0.05,
        top: rect.bottom - 14,
        width: rect.width * 0.90,
        height: 46
    });

    $('#book-floor-shadow-soft').css({
        left: rect.left - rect.width * 0.05,
        top: rect.bottom - 34,
        width: rect.width * 1.10,
        height: 80
    });

    // 책 뒤 종이색 배경 - 책과 정확히 같은 크기/위치 (전환 중 배경이 비치는 것 방지)
    $('#book-backing').css({
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height
    });

    // 제본선 그림자는 2페이지(펼침면) 모드일 때만 필요합니다. 1페이지 모드에서는
    // 화면에 페이지가 한 장만 보이므로, 가운데에 제본선 그림자가 나타나면 페이지
    // 내용 한가운데를 가로지르는 정체불명의 어두운 선처럼 보이는 문제가 있었습니다.
    if (currentDisplayMode === 'single') {
        $('#book-gutter-shadow').css({ width: 0, height: 0 });
    } else {
        $('#book-gutter-shadow').css({
            left: rect.left + rect.width / 2 - 45,
            top: rect.top,
            width: 90,
            height: rect.height
        });
    }

    refreshMemoDots(rect);

    // 배경 -> 그림자 -> 책두께감 -> 책 순서로 보이도록, 책 오른쪽 가장자리 "바깥"
    // (책과 배경 사이 틈)에 종이 두께를 표현. 페이지가 겹쳐서 생긴 형태이므로
    // 세로 길이는 항상 책(페이지)의 세로 길이와 정확히 같아야 함 (화면 확대/축소 시에도 동일하게 따라감).
    var thickW = Math.max(9, rect.width * 0.014);
    $('#book-thickness-right').css({
        left: rect.left + rect.width,
        top: rect.top,
        width: thickW,
        height: rect.height
    });

    // 책 좌/우 바깥 가장자리 클릭 -> 페이지 넘김
    var edgeClickW = Math.max(28, rect.width * 0.07);
    $('#edge-zone-left').css({ left: rect.left, top: rect.top, width: edgeClickW, height: rect.height });
    $('#edge-zone-right').css({ left: rect.left + rect.width - edgeClickW, top: rect.top, width: edgeClickW, height: rect.height });
}

// turn.js 페이지 번호 -> 실제 카탈로그 인쇄 페이지 번호(라벨). 내지 1p는 null(무시).
function labelFor(turnPage) {
    var n = turnPage - 2;
    if (n < 1 || n > LAST_LABEL_NUM) return null;
    return String(n);
}

function updatePageNumber(page) {
    var text;
    var view = $('#flipbook').turn('view'); // [leftPage, rightPage]
    var labels = [];
    if (view && view.length === 2) {
        var a = labelFor(view[0]);
        var b = labelFor(view[1]);
        if (a) labels.push(a);
        if (b) labels.push(b);
    } else {
        var single = labelFor(page);
        if (single) labels.push(single);
    }
    if (labels.length === 0) {
        text = '1 / ' + LAST_LABEL_NUM;
    } else if (labels.length === 1) {
        text = labels[0] + ' / ' + LAST_LABEL_NUM;
    } else {
        text = labels[0] + '-' + labels[1] + ' / ' + LAST_LABEL_NUM;
    }
    $('#top-page-indicator-text').text(text);
}

function goToPage(pageNum, _isBackNav) {
    if (!bookInitialized) return;
    if (!_isBackNav) {
        try {
            var cur = $('#flipbook').turn('page');
            if (cur && cur !== pageNum) jumpReturnPage = cur;
        } catch (err) { /* 무시 */ }
    }
    try {
        $('#flipbook').turn('page', pageNum);
    } catch (err) { return; }
    // 목차/검색/핫스팟처럼 먼 페이지로 점프할 때, turn.js 내부 재배치가 끝난 뒤
    // 그림자/핫스팟/메모 아이콘 위치를 한 번 더 안전하게 맞춰줍니다.
    setTimeout(function(){
        try {
            var $fbEl = $('#flipbook')[0];
            if ($fbEl) {
                var rect = $fbEl.getBoundingClientRect();
                positionShadows();
                refreshMemoDots(rect);
            }
        } catch (err) { /* 무시 */ }
    }, 220);
}

// ===================== 공용 오버레이 패널 (목차 / 검색 / 페이지 / 메모) =====================
var currentPanel = null;
var PANEL_TITLES = { toc: '목차', search: '검색', page: '페이지 이동', memo: '메모' };
var tocActiveCategory = '전체';
var searchActiveSort = '페이지순';

function openPanel(type) {
    currentPanel = type;
    $('#panelTitle').text(PANEL_TITLES[type] || '');
    var $body = $('#panelBody').empty();

    // 매번 열 때는 기본(가운데) 위치로 초기화 - 드래그로 옮긴 위치는 이번 열람 동안만 유지됩니다.
    $('#panel').css({ position: '', left: '', top: '', margin: '', transform: '' });

    if (type === 'toc') {
        renderTocPanel($body);
    } else if (type === 'search') {
        renderSearchPanel($body);
    } else if (type === 'page') {
        renderPagePanel($body);
    } else if (type === 'memo') {
        renderMemoPanel($body);
    }

    $('#overlay').removeClass('hidden');
    if (type === 'search') {
        setTimeout(function(){ $('#panel-search-input').trigger('focus'); }, 60);
    }
}

function closePanel() {
    $('#overlay').addClass('hidden');
    currentPanel = null;
}

// 팝업 박스를 헤더를 잡고 원하는 위치로 자유롭게 드래그해서 옮길 수 있게 함
function setupPanelDragging() {
    var $panel = $('#panel');
    var $header = $('#panelHeader');
    var dragging = false, startX, startY, origLeft, origTop;

    $header.on('mousedown touchstart', function(e){
        if ($(e.target).closest('#panelClose').length) return;
        var p = e.touches ? e.touches[0] : e;
        dragging = true;
        var rect = $panel[0].getBoundingClientRect();
        startX = p.clientX; startY = p.clientY;
        origLeft = rect.left; origTop = rect.top;
        $panel.css({ position: 'fixed', left: origLeft + 'px', top: origTop + 'px', margin: 0, transform: 'none' });
    });
    $(document).on('mousemove touchmove', function(e){
        if (!dragging) return;
        var p = e.touches ? e.touches[0] : e;
        if (e.touches) e.preventDefault();
        var dx = p.clientX - startX, dy = p.clientY - startY;
        var maxLeft = window.innerWidth - $panel.outerWidth() + 20;
        var maxTop = window.innerHeight - 40;
        var newLeft = Math.max(-20, Math.min(maxLeft, origLeft + dx));
        var newTop = Math.max(0, Math.min(maxTop, origTop + dy));
        $panel.css({ left: newLeft + 'px', top: newTop + 'px' });
    });
    $(document).on('mouseup touchend', function(){ dragging = false; });
}

function renderContentList($list, items) {
    $list.empty();
    if (items.length === 0) {
        $('<li class="panel-no-result"></li>').text('해당하는 항목이 없습니다.').appendTo($list);
        return;
    }
    items.forEach(function(item) {
        var badge = item.label || labelFor(item.turnPage) || '';
        $('<li></li>')
            .attr('data-target-page', item.targetPage != null ? item.targetPage : item.turnPage)
            .append($('<span class="item-label"></span>').text(item.name))
            .append($('<span class="item-badge"></span>').text(badge + 'p'))
            .appendTo($list);
    });
}

// 목차/검색 리스트 클릭 처리: 개별 li 마다 따로 바인딩하지 않고, 목록 전체(부모) 하나에만
// 이벤트를 걸어두는 "이벤트 위임" 방식을 씁니다. 목록이 다시 그려져도(검색어 입력 등)
// 항상 안정적으로 동작하는, jQuery에서 가장 표준적이고 검증된 동적 목록 처리 방식입니다.
function setupContentListDelegation() {
    $(document).on('click', '.panel-list li[data-target-page]', function(){
        var tp = parseInt($(this).attr('data-target-page'), 10);
        if (!tp) return;
        goToPage(tp);
        closePanel();
    });
}

// ----- 목차: 카테고리 탭으로 분류해서 보기 -----
function renderTocPanel($body) {
    var $chips = $('<div class="chip-row"></div>');
    CATEGORIES.forEach(function(cat) {
        $('<div class="chip"></div>')
            .text(cat)
            .toggleClass('active', cat === tocActiveCategory)
            .on('click', function(){
                tocActiveCategory = cat;
                $chips.find('.chip').removeClass('active');
                $(this).addClass('active');
                applyFilter();
            })
            .appendTo($chips);
    });
    $body.append($chips);
    var $list = $('<ul class="panel-list"></ul>');
    $body.append($list);

    function applyFilter() {
        var items = CONTENTS.filter(function(item) {
            return tocActiveCategory === '전체' || item.category === tocActiveCategory;
        });
        renderContentList($list, items);
    }
    applyFilter();
}

// ----- 검색: 가나다순 / 페이지순 정렬 선택 후 검색 -----
function renderSearchPanel($body) {
    var $chips = $('<div class="chip-row"></div>');
    ['페이지순', '가나다순'].forEach(function(sortName) {
        $('<div class="chip"></div>')
            .text(sortName)
            .toggleClass('active', sortName === searchActiveSort)
            .on('click', function(){
                searchActiveSort = sortName;
                $chips.find('.chip').removeClass('active');
                $(this).addClass('active');
                applySearch($input.val());
            })
            .appendTo($chips);
    });
    $body.append($chips);

    var $input = $('<input type="text" class="panel-search-input" id="panel-search-input" placeholder="제품명으로 검색... (예: 그레인1000)">');
    $input.on('input', function(){ applySearch(this.value); });
    $body.append($input);

    var $list = $('<ul class="panel-list"></ul>');
    $body.append($list);

    function applySearch(query) {
        query = (query || '').trim().toLowerCase();
        var items = CONTENTS.filter(function(item) {
            return !query || item.name.toLowerCase().indexOf(query) !== -1;
        });
        items = items.slice();
        if (searchActiveSort === '가나다순') {
            items.sort(function(a,b){ return a.name.localeCompare(b.name, 'ko'); });
        } else {
            items.sort(function(a,b){ return a.turnPage - b.turnPage; });
        }
        renderContentList($list, items);
    }
    applySearch('');
}

// ----- 페이지 이동: 슬라이더 + 번호 입력 동시 사용 -----
function renderPagePanel($body) {
    var curLabel = parseInt(currentContentLabel(), 10) || 1;

    var $valueDisplay = $('<div class="page-slider-wrap"></div>');
    var $valueText = $('<div class="page-slider-value"></div>');
    $valueText.html(curLabel + ' <span>/ ' + LAST_LABEL_NUM + 'p</span>');
    $valueDisplay.append($valueText);

    var $slider = $('<input type="range" id="page-slider">')
        .attr('min', 1).attr('max', LAST_LABEL_NUM).val(curLabel);
    $valueDisplay.append($slider);
    $body.append($valueDisplay);

    $slider.on('input', function(){
        $valueText.html(this.value + ' <span>/ ' + LAST_LABEL_NUM + 'p</span>');
    });
    $slider.on('change', function(){
        jumpToLabel(this.value);
    });

    var $row = $('<div class="page-jump-row"></div>');
    var $input = $('<input type="number" min="1" max="' + LAST_LABEL_NUM + '" placeholder="번호 입력 (1~' + LAST_LABEL_NUM + ')">');
    var $btn = $('<button>이동</button>');
    $row.append($input).append($btn);
    $body.append($row);
    $body.append('<div class="page-jump-hint">슬라이더를 움직이거나 번호를 입력해서 이동하세요</div>');

    function jumpToLabel(n) {
        n = parseInt(n, 10);
        if (!n || n < 1 || n > LAST_LABEL_NUM) return;
        goToPage(n + 2); // label n -> turnPage n+2
    }
    function jumpAndClose(n) {
        n = parseInt(n, 10);
        if (!n || n < 1 || n > LAST_LABEL_NUM) return;
        var targetPage = n + 2;
        closePanel();
        setTimeout(function(){ goToPage(targetPage); }, 30);
    }
    $btn.on('click', function(){ jumpAndClose($input.val()); });
    $input.on('keydown', function(e){ if (e.key === 'Enter') { jumpAndClose($input.val()); } });
}

function currentContentLabel() {
    var view = $('#flipbook').turn('view');
    if (view && view.length === 2) {
        return labelFor(view[0]) || labelFor(view[1]) || '1';
    }
    return labelFor($('#flipbook').turn('page')) || '1';
}

// ===================== 메모 (세션 동안만 메모리에 저장, 페이지당 여러 개 + 색상) =====================
var memoStore = {};      // key: turn.js page number -> array of {id, text, color}
var memoIdSeq = 1;
var MEMO_COLORS = ['#ffd94a', '#ff6b6b', '#6bd47a', '#5aa9ff', '#c084fc', '#c9c9c9'];
var memoSelectedColor = MEMO_COLORS[0];

function currentMemoKey() {
    return $('#flipbook').turn('page');
}

function renderMemoPanel($body) {
    var curKey = currentMemoKey();
    var curLabel = parseInt(labelFor(curKey) || labelFor(curKey - 1) || '1', 10);
    var targetLabel = curLabel; // 사용자가 고르는 메모 대상 페이지(라벨 번호)

    var $addBox = $('<div class="memo-add-box"></div>');
    $addBox.append('<div class="memo-current-page">메모를 남길 페이지를 선택하거나 직접 입력하세요</div>');

    var $pageRow = $('<div class="memo-page-picker"></div>');
    var $pageValue = $('<div class="memo-page-value"></div>').html(targetLabel + ' <span>/ ' + LAST_LABEL_NUM + 'p</span>');
    var $pageSlider = $('<input type="range">').attr('min', 1).attr('max', LAST_LABEL_NUM).val(targetLabel);
    var $pageInput = $('<input type="number" class="memo-page-input">').attr('min', 1).attr('max', LAST_LABEL_NUM).val(targetLabel);

    $pageSlider.on('input', function(){
        targetLabel = parseInt(this.value, 10);
        $pageValue.html(targetLabel + ' <span>/ ' + LAST_LABEL_NUM + 'p</span>');
        $pageInput.val(targetLabel);
    });
    $pageSlider.on('change', function(){
        // 슬라이더를 놓으면(선택을 마치면) 책도 그 페이지로 함께 이동해서 보여줍니다.
        goToPage(targetLabel + 2);
    });
    $pageInput.on('input', function(){
        var n = parseInt(this.value, 10);
        if (!n || n < 1) return;
        if (n > LAST_LABEL_NUM) n = LAST_LABEL_NUM;
        targetLabel = n;
        $pageSlider.val(n);
        $pageValue.html(n + ' <span>/ ' + LAST_LABEL_NUM + 'p</span>');
    });
    $pageInput.on('change', function(){
        goToPage(targetLabel + 2);
    });

    $pageRow.append($pageValue).append($pageSlider).append($pageInput);
    $addBox.append($pageRow);

    var $colorRow = $('<div class="color-row"></div>');
    MEMO_COLORS.forEach(function(c) {
        $('<div class="color-dot-choice"></div>')
            .css('background', c)
            .toggleClass('selected', c === memoSelectedColor)
            .on('click', function(){
                memoSelectedColor = c;
                $colorRow.find('.color-dot-choice').removeClass('selected');
                $(this).addClass('selected');
            })
            .appendTo($colorRow);
    });
    $addBox.append($colorRow);

    var $ta = $('<textarea id="memo-textarea" placeholder="메모 내용을 입력하세요..."></textarea>');
    $addBox.append($ta);
    var $addBtn = $('<button class="memo-add-btn">+ 선택한 페이지에 메모 추가</button>');
    $addBox.append($addBtn);
    $body.append($addBox);

    $addBtn.on('click', function(){
        var text = $ta.val().trim();
        if (!text) return;
        var key = targetLabel + 2; // 라벨 -> turnPage
        if (!memoStore[key]) memoStore[key] = [];
        memoStore[key].push({ id: memoIdSeq++, text: text, color: memoSelectedColor, dx: null, dy: null });
        $ta.val('');
        refreshMemoDots();
        renderMemoList();
    });

    $body.append('<div class="memo-list-title">전체 메모 목록</div>');
    var $list = $('<div></div>');
    $body.append($list);

    function renderMemoList() {
        $list.empty();
        var all = [];
        Object.keys(memoStore).forEach(function(pageKey) {
            (memoStore[pageKey] || []).forEach(function(m) {
                all.push({ pageKey: parseInt(pageKey,10), memo: m });
            });
        });
        if (all.length === 0) {
            $('<div class="memo-empty-hint"></div>').text('아직 작성된 메모가 없습니다. 위에서 메모를 추가해보세요.').appendTo($list);
            return;
        }
        all.sort(function(a,b){ return a.pageKey - b.pageKey; });
        all.forEach(function(entry) {
            var pLabel = labelFor(entry.pageKey) || labelFor(entry.pageKey - 1) || '?';
            var $row = $('<div class="memo-item"></div>');
            $('<div class="memo-color-dot"></div>').css('background', entry.memo.color).appendTo($row);
            var $bodyDiv = $('<div class="memo-item-body"></div>');
            $bodyDiv.append($('<div class="memo-item-page"></div>').text(pLabel + 'p'));
            $bodyDiv.append($('<div class="memo-item-text"></div>').text(entry.memo.text));
            $row.append($bodyDiv);
            var $del = $('<div class="memo-item-del">✕</div>');
            $del.on('click', function(e){
                e.stopPropagation();
                memoStore[entry.pageKey] = (memoStore[entry.pageKey]||[]).filter(function(m){ return m.id !== entry.memo.id; });
                refreshMemoDots();
                renderMemoList();
            });
            $row.append($del);
            $row.on('click', function(){ goToPage(entry.pageKey); closePanel(); });
            $list.append($row);
        });
    }
    renderMemoList();
}

// memoId -> {xPct, yPct} 사용자가 드래그로 옮긴 "개별 메모" 아이콘의 페이지 내 상대 위치(0~100)
var memoDotPos = {};

function refreshMemoDots(rect) {
    if (!rect) {
        var $fb = $('#flipbook');
        if (!$fb.length) return;
        rect = $fb[0].getBoundingClientRect();
    }
    if (!rect.width || !rect.height) return;
    if (!bookInitialized) return;

    var view;
    try { view = $('#flipbook').turn('view'); } catch (err) { return; }
    var leftPage, rightPage;
    if (view && view.length === 2) { leftPage = view[0]; rightPage = view[1]; }
    else {
        try { leftPage = rightPage = $('#flipbook').turn('page'); } catch (err) { return; }
    }

    var single = (currentDisplayMode === 'single');
    var halfW = single ? rect.width : rect.width / 2;
    var $layer = $('#memo-dot-layer');

    // 드래그 중인 아이콘은 다시 그리다가 위치가 튀지 않도록 건너뜁니다.
    var draggingId = $layer.data('draggingMemoId');

    $layer.empty();

    function placeSide(pageKey, isLeftSide) {
        var memos = memoStore[pageKey] || [];
        if (!memos.length) return;
        var baseX = rect.left + ((single || isLeftSide) ? 0 : halfW);
        // 페이지 넘김 클릭 영역(바깥쪽 가장자리)과 겹치지 않도록, 기본 위치를 안쪽(제본선 쪽)으로 배치
        // 왼쪽 페이지 -> 오른쪽(안쪽)에서 시작, 오른쪽 페이지 -> 왼쪽(안쪽)에서 시작
        var anchorInward = !single && isLeftSide;

        memos.forEach(function(m, i){
            if (draggingId === m.id) return; // 드래그 중인 아이콘은 건너뜀(별도로 이미 화면에 있음)
            var pos = memoDotPos[m.id];
            var x, y;
            if (pos) {
                x = baseX + (pos.xPct / 100) * halfW;
                y = rect.top + (pos.yPct / 100) * rect.height;
            } else {
                // 기본 배치: 안쪽(제본선 인근)에서 시작해 작은 격자 형태로 나열 (4개씩 줄바꿈)
                var col = i % 4, row = Math.floor(i / 4);
                var gx = 16 + col * 26;
                var gy = 16 + row * 26;
                x = baseX + (anchorInward ? (halfW - gx - 22) : gx);
                y = rect.top + gy;
            }
            var $dot = $('<div class="memoDot"></div>')
                .attr('title', m.text.length > 40 ? m.text.slice(0,40) + '…' : m.text)
                .css({ left: x + 'px', top: y + 'px', background: m.color })
                .data('memoId', m.id)
                .data('pageKey', pageKey);
            $layer.append($dot);
        });
    }

    placeSide(leftPage, true);
    placeSide(rightPage, false);
}

// 메모 아이콘을 사용자가 원하는 위치로 드래그해서 옮길 수 있게 함 (아이콘 1개 = 메모 1개)
function setupMemoDotDragging() {
    var $layer = $('#memo-dot-layer');
    var dragging = null;
    var dragSafetyTimer = null;
    var DRAG_THRESHOLD = 6; // 이 거리 이상 움직여야 "드래그"로 인정, 그 이하는 "클릭"

    function pointFromEvent(e) {
        if (e.touches && e.touches.length) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
        if (e.changedTouches && e.changedTouches.length) return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
        return { x: e.clientX, y: e.clientY };
    }

    function startDrag(e, $dot) {
        e.preventDefault();
        e.stopPropagation(); // 아래에 있는 목차 핫스팟 등으로 이벤트가 전달되지 않도록
        var $fb = $('#flipbook');
        if (!$fb.length) return;
        var rect = $fb[0].getBoundingClientRect();
        var single = (currentDisplayMode === 'single');
        var halfW = single ? rect.width : rect.width / 2;
        var dotLeft = parseFloat($dot.css('left'));
        var isLeftSide = single ? true : (dotLeft < rect.left + halfW);
        var baseX = rect.left + ((single || isLeftSide) ? 0 : halfW);
        var p = pointFromEvent(e);
        dragging = {
            $dot: $dot, rect: rect, halfW: halfW, baseX: baseX,
            memoId: $dot.data('memoId'), pageKey: $dot.data('pageKey'),
            startX: p.x, startY: p.y, moved: false
        };
        $layer.data('draggingMemoId', dragging.memoId);
        // 안전장치: 혹시라도 mouseup/touchend를 놓쳐도 책이 영구히 멈추지 않도록
        clearTimeout(dragSafetyTimer);
        dragSafetyTimer = setTimeout(function(){ endDrag(); }, 8000);
    }

    function moveDrag(e) {
        if (!dragging) return;
        var p = pointFromEvent(e);
        var dist = Math.hypot(p.x - dragging.startX, p.y - dragging.startY);
        if (!dragging.moved && dist > DRAG_THRESHOLD) {
            dragging.moved = true;
            dragging.$dot.addClass('dragging');
            closeMemoQuickView();
            // 드래그 중에는 책(turn.js) 쪽 클릭/드래그 인식과 겹치지 않도록 잠시 비활성화
            $('#flipbook').css('pointer-events', 'none');
        }
        if (!dragging.moved) return;
        var x = p.x - dragging.$dot.width() / 2;
        var y = p.y - dragging.$dot.height() / 2;
        // 페이지 영역 안쪽으로 제한
        x = Math.max(dragging.baseX - 10, Math.min(dragging.baseX + dragging.halfW - dragging.$dot.width() + 10, x));
        y = Math.max(dragging.rect.top - 10, Math.min(dragging.rect.top + dragging.rect.height - dragging.$dot.height() + 10, y));
        dragging.$dot.css({ left: x + 'px', top: y + 'px' });
    }

    function endDrag(e) {
        if (!dragging) return;
        clearTimeout(dragSafetyTimer);
        var d = dragging;
        d.$dot.removeClass('dragging');
        $layer.removeData('draggingMemoId');
        $('#flipbook').css('pointer-events', ''); // 책 클릭/드래그 다시 활성화
        if (d.moved) {
            var left = parseFloat(d.$dot.css('left')), top = parseFloat(d.$dot.css('top'));
            var xPct = (left - d.baseX) / d.halfW * 100;
            var yPct = (top - d.rect.top) / d.rect.height * 100;
            if (d.memoId != null) {
                memoDotPos[d.memoId] = { xPct: xPct, yPct: yPct };
            }
        } else {
            // 움직이지 않았다면 클릭으로 간주 -> 이 메모 하나의 내용 바로 보기
            showMemoQuickView(d.pageKey, d.memoId, d.$dot);
        }
        dragging = null;
    }

    $layer.on('mousedown', '.memoDot', function(e){ startDrag(e, $(this)); });
    $layer.on('touchstart', '.memoDot', function(e){ startDrag(e, $(this)); });
    $(document).on('mousemove', moveDrag);
    $(document).on('touchmove', function(e){ if (dragging && dragging.moved) e.preventDefault(); moveDrag(e); }, { passive: false });
    $(document).on('mouseup', endDrag);
    $(document).on('touchend', endDrag);
}

// 메모 아이콘을 클릭(드래그 아님)하면 그 메모 하나의 내용을 바로 확인할 수 있는 말풍선
function showMemoQuickView(pageKey, memoId, $dot) {
    closeMemoQuickView();
    if (pageKey == null) return;
    var memos = memoStore[pageKey] || [];
    var memo = memos.filter(function(m){ return m.id === memoId; })[0];
    if (!memo) return;

    var offset = $dot.offset();
    var pLabel = labelFor(pageKey) || labelFor(pageKey - 1) || '?';

    var $bubble = $('<div id="memo-quickview"></div>');
    $bubble.append('<div class="memo-quickview-title">' + pLabel + 'p 메모 <span class="memo-quickview-close">✕</span></div>');
    var $row = $('<div class="memo-quickview-item"></div>');
    $('<span class="memo-quickview-dot"></span>').css('background', memo.color).appendTo($row);
    $('<span class="memo-quickview-text"></span>').text(memo.text).appendTo($row);
    $bubble.append($row);
    var $delBtn = $('<button class="memo-quickview-delete">이 메모 삭제</button>');
    $bubble.append($delBtn);
    $('body').append($bubble);

    $delBtn.on('click', function(e){
        e.stopPropagation();
        memoStore[pageKey] = (memoStore[pageKey] || []).filter(function(m){ return m.id !== memoId; });
        delete memoDotPos[memoId];
        closeMemoQuickView();
        refreshMemoDots();
    });

    // 화면 안에 들어오도록 위치 보정
    var bw = $bubble.outerWidth(), bh = $bubble.outerHeight();
    var left = offset.left + $dot.outerWidth()/2 - bw/2;
    var top = offset.top + $dot.outerHeight() + 10;
    left = Math.max(10, Math.min(window.innerWidth - bw - 10, left));
    if (top + bh > window.innerHeight - 10) top = offset.top - bh - 10;
    $bubble.css({ left: left + 'px', top: top + 'px' });

    $bubble.find('.memo-quickview-close').on('click', function(e){
        e.stopPropagation();
        closeMemoQuickView();
    });
    $bubble.on('mousedown touchstart', function(e){ e.stopPropagation(); });

    setTimeout(function(){
        $(document).on('mousedown.memoqv touchstart.memoqv', function(e){
            if (!$(e.target).closest('#memo-quickview, .memoDot').length) closeMemoQuickView();
        });
    }, 0);
}

function closeMemoQuickView() {
    $('#memo-quickview').remove();
    $(document).off('mousedown.memoqv touchstart.memoqv');
}


// ===================== 전체화면 =====================
function toggleFullscreen() {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(function(err){
            alert('전체화면 전환 오류: ' + err.message);
        });
    } else {
        document.exitFullscreen();
    }
}

// ===================== 확대(돋보기) 보기 =====================
var zoomScale = 1, zoomX = 0, zoomY = 0;
var zoomDragging = false, zoomDragStartX = 0, zoomDragStartY = 0, zoomStartX = 0, zoomStartY = 0;

function currentSpreadImages() {
    var view = $('#flipbook').turn('view');
    var imgs = [];
    if (view && view.length === 2) {
        var p1 = pagePathForTurn(view[0]); if (p1) imgs.push(p1);
        var p2 = pagePathForTurn(view[1]); if (p2) imgs.push(p2);
    } else {
        var p = pagePathForTurn($('#flipbook').turn('page'));
        if (p) imgs.push(p);
    }
    return imgs;
}

function openZoom() {
    var imgs = currentSpreadImages();
    var $l = $('#zoom-img-left'), $r = $('#zoom-img-right');
    if (imgs[0]) { $l.attr('src', imgs[0]).show(); } else { $l.hide(); }
    if (imgs[1]) { $r.attr('src', imgs[1]).show(); } else { $r.hide(); }
    zoomReset();
    $('#zoom-overlay').addClass('show');
}
function closeZoom() {
    $('#zoom-overlay').removeClass('show');
}
function applyZoomTransform() {
    $('#zoom-canvas').css('transform', 'translate(' + zoomX + 'px,' + zoomY + 'px) scale(' + zoomScale + ')');
    $('#zoom-pct').text(Math.round(zoomScale*100) + '%');
}
function zoomChange(delta) {
    zoomScale = Math.min(2.5, Math.max(1, zoomScale + delta));
    if (zoomScale === 1) { zoomX = 0; zoomY = 0; }
    applyZoomTransform();
}
function zoomReset() {
    zoomScale = 1; zoomX = 0; zoomY = 0;
    applyZoomTransform();
}

$(document).ready(function() {
    var $vp = $('#zoom-viewport');
    $vp.on('wheel', function(e) {
        e.preventDefault();
        var delta = e.originalEvent.deltaY < 0 ? 0.15 : -0.15;
        zoomScale = Math.min(2.5, Math.max(1, zoomScale + delta));
        if (zoomScale === 1) { zoomX = 0; zoomY = 0; }
        applyZoomTransform();
    });
    $vp.on('mousedown', function(e) {
        if (zoomScale <= 1) return;
        zoomDragging = true;
        $vp.addClass('dragging');
        zoomDragStartX = e.clientX; zoomDragStartY = e.clientY;
        zoomStartX = zoomX; zoomStartY = zoomY;
    });
    $(document).on('mousemove', function(e) {
        if (!zoomDragging) return;
        zoomX = zoomStartX + (e.clientX - zoomDragStartX);
        zoomY = zoomStartY + (e.clientY - zoomDragStartY);
        applyZoomTransform();
    });
    $(document).on('mouseup', function() {
        zoomDragging = false;
        $vp.removeClass('dragging');
    });
    // 터치 지원 (모바일 드래그로 이동)
    $vp.on('touchstart', function(e) {
        if (zoomScale <= 1) return;
        var t = e.originalEvent.touches[0];
        zoomDragging = true;
        zoomDragStartX = t.clientX; zoomDragStartY = t.clientY;
        zoomStartX = zoomX; zoomStartY = zoomY;
    });
    $vp.on('touchmove', function(e) {
        if (!zoomDragging) return;
        e.preventDefault();
        var t = e.originalEvent.touches[0];
        zoomX = zoomStartX + (t.clientX - zoomDragStartX);
        zoomY = zoomStartY + (t.clientY - zoomDragStartY);
        applyZoomTransform();
    });
    $vp.on('touchend', function() { zoomDragging = false; });

    $(document).on('keydown', function(e) {
        if (e.key === 'Escape') { closePanel(); closeZoom(); }
    });
});

// ===================== 모바일 대응 (반응형) =====================
var MOBILE_BREAKPOINT = 700;
var currentDisplayMode = 'double';

function isMobileViewport() {
    // 화면의 "짧은 쪽" 길이로 판정합니다. 휴대폰은 가로로 눕혀도 짧은 쪽(세로 길이)이
    // 여전히 작지만, 이전에는 가로 폭만 봐서 휴대폰을 가로로 눕히면 폭이 커서
    // "PC 화면"으로 잘못 판정되는 문제가 있었습니다.
    //
    // outerWidth/outerHeight와 innerWidth/innerHeight 둘 다 확인해서, 둘 중 하나라도
    // "작은 화면"으로 나오면 모바일로 판단합니다(OR 조건). 일부 모바일 브라우저에서는
    // outerHeight 값이 브라우저 주소창 등을 포함해 예상과 다르게 나올 수 있는데,
    // 이 경우에도 innerWidth/innerHeight 기준으로 안전하게 모바일임을 잡아내기 위함입니다.
    // (CSS 쪽 미디어쿼리도 innerWidth/innerHeight에 해당하는 뷰포트 기준이라, 이렇게 해야
    // 화면에 보이는 모습과 크기 계산이 항상 일치합니다.)
    var ow = (window.outerWidth && window.outerWidth > 0) ? window.outerWidth : window.innerWidth;
    var oh = (window.outerHeight && window.outerHeight > 0) ? window.outerHeight : window.innerHeight;
    var byOuter = Math.min(ow, oh) <= MOBILE_BREAKPOINT;
    var byInner = Math.min(window.innerWidth, window.innerHeight) <= MOBILE_BREAKPOINT;
    return byOuter || byInner;
}

// ===================== PWA: 설치(홈 화면 추가) 지원 =====================
// file:// 로 직접 열었을 때는 서비스워커 등록이 지원되지 않으므로(브라우저 제한),
// 로컬 서버(http://localhost 등)로 열었을 때만 동작하고 그 외에는 조용히 무시합니다.
//
// "캐시를 수동으로 지워야만 최신 버전이 반영된다"는 불편함을 없애기 위해,
// 카탈로그를 실행할 때마다 자동으로 다음을 전부 수행합니다:
// 1) 서비스워커 스크립트 자체를 브라우저가 자체적으로 캐시하지 못하게 막아서,
//    항상 최신 서비스워커 파일을 확인하도록 함 (updateViaCache: 'none')
// 2) 실행 즉시 새 버전이 있는지 능동적으로 확인 (update() 직접 호출)
// 3) 새 버전의 서비스워커가 실제로 이 화면을 담당하게 되는 순간, 화면을
//    자동으로 한 번 새로고침해서 예전 캐시가 완전히 정리된 새 화면으로 전환
// 4) 위 과정과 별개로, 현재 버전과 이름이 다른 예전 캐시가 남아있으면
//    서비스워커의 활성화를 기다리지 않고 이 화면에서 직접 바로 지움
var APP_VERSION = 'v3.10';
var CACHE_NAME_PREFIX = 'hansol-ecatalog-';

function purgeStaleCachesNow() {
    if (!('caches' in window)) return;
    var currentCacheName = CACHE_NAME_PREFIX + APP_VERSION;
    caches.keys().then(function (names) {
        names.forEach(function (name) {
            if (name.indexOf(CACHE_NAME_PREFIX) === 0 && name !== currentCacheName) {
                caches.delete(name);
            }
        });
    }).catch(function () { /* 무시 */ });
}

(function registerServiceWorkerIfSupported(){
    if (!('serviceWorker' in navigator)) return;
    if (location.protocol !== 'http:' && location.protocol !== 'https:') return;

    // 이 화면이 열려있는 동안 "새 서비스워커로 교체됨" 신호가 오면, 예전 캐시로
    // 계속 보고 있지 않도록 딱 한 번 자동으로 새로고침합니다.
    var reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
        if (reloaded) return;
        reloaded = true;
        window.location.reload();
    });

    window.addEventListener('load', function () {
        navigator.serviceWorker.register('service-worker.js', { updateViaCache: 'none' })
            .then(function (registration) {
                // 실행하자마자 곧바로 "새 버전이 있는지" 능동적으로 확인합니다
                // (브라우저가 자체적으로 나중에 확인할 때까지 기다리지 않음).
                registration.update().catch(function () { /* 무시 */ });
            })
            .catch(function () {
                // 등록 실패해도 카탈로그 기본 기능에는 영향 없음 (조용히 무시)
            });

        purgeStaleCachesNow();
    });
})();

