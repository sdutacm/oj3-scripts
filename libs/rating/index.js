'use strict';

/*! *****************************************************************************
Copyright (c) Microsoft Corporation. All rights reserved.
Licensed under the Apache License, Version 2.0 (the "License"); you may not use
this file except in compliance with the License. You may obtain a copy of the
License at http://www.apache.org/licenses/LICENSE-2.0

THIS CODE IS PROVIDED ON AN *AS IS* BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
KIND, EITHER EXPRESS OR IMPLIED, INCLUDING WITHOUT LIMITATION ANY IMPLIED
WARRANTIES OR CONDITIONS OF TITLE, FITNESS FOR A PARTICULAR PURPOSE,
MERCHANTABLITY OR NON-INFRINGEMENT.

See the Apache Version 2.0 License for specific language governing permissions
and limitations under the License.
***************************************************************************** */

function __awaiter(thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
}

function calP(a, b) {
    return 1.0 / (1.0 + Math.pow(10, (b.oldRating - a.oldRating) / 400.0));
}
function calSeed(users, idx, rating) {
    const exUser = {
        userId: 0,
        rank: 0,
        _rank: 0.0,
        oldRating: rating,
        newRating: 0,
        seed: 1.0,
        delta: 0,
    };
    let res = 1.0;
    for (let i = 0; i < users.length; ++i) {
        if (i !== idx) {
            res += calP(users[i], exUser);
        }
    }
    return res;
}
function calRatingToRank(users, idx, rank) {
    let l = 1;
    let r = 8000;
    while (r - l > 1) {
        const mid = Math.floor((l + r) / 2);
        if (calSeed(users, idx, mid) < rank) {
            r = mid;
        }
        else {
            l = mid;
        }
    }
    return l;
}
function calRating(users, progressCallback) {
    return __awaiter(this, void 0, void 0, function* () {
        for (let i = 0; i < users.length; ++i) {
            for (let j = 0; j < users.length; ++j) {
                if (i !== j) {
                    users[i].seed += calP(users[j], users[i]);
                }
            }
        }
        let sumDelta = 0;
        let _lastProgress = 0;
        for (let i = 0; i < users.length; ++i) {
            let _newProgress = Math.floor((i + 1) / users.length * 100);
            if (_newProgress !== _lastProgress) {
                if (typeof progressCallback === 'function') {
                    yield progressCallback(_newProgress);
                }
                _lastProgress = _newProgress;
            }
            const user = users[i];
            const m = Math.sqrt(user._rank * user.seed);
            const R = calRatingToRank(users, i, m);
            user.delta = Math.floor((R - user.oldRating) / 2);
            sumDelta += user.delta;
        }
        let inc = -Math.floor(sumDelta / users.length) - 1;
        for (const user of users) {
            user.delta += inc;
        }
        users.sort((a, b) => b.oldRating - a.oldRating);
        const s = Math.min(users.length, 4 * Math.round(Math.sqrt(users.length)));
        let sumS = 0;
        for (let i = 0; i < s; ++i) {
            sumS += users[i].delta;
        }
        inc = Math.min(Math.max(-Math.floor(sumS / s), -10), 0);
        for (const user of users) {
            user.delta += inc;
        }
        for (const user of users) {
            user.newRating = user.oldRating + user.delta;
        }
        users.sort((a, b) => a._rank - b._rank);
    });
}
function reassignRankToPost(users) {
    let lastIdx = 0;
    let lastRank = 1;
    for (let i = 0; i < users.length; ++i) {
        users[i]._rank = users[i].rank;
        if (users[i]._rank > lastRank) {
            for (let j = lastIdx; j < i; ++j) {
                users[j]._rank = i;
            }
            lastIdx = i;
            lastRank = users[i]._rank;
        }
    }
    for (let i = lastIdx; i < users.length; ++i) {
        users[i]._rank = users.length;
    }
}
function calculateRating(opt) {
    return __awaiter(this, void 0, void 0, function* () {
        const users = opt.users.map(user => ({
            userId: user.userId,
            rank: user.rank,
            _rank: 0.0,
            oldRating: user.oldRating,
            newRating: 0,
            seed: 1.0,
            delta: 0,
        }));
        reassignRankToPost(users);
        yield calRating(users, opt.onProgress);
        return users;
    });
}

module.exports = calculateRating;
//# sourceMappingURL=index.cjs.js.map
