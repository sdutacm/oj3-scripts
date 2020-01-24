export interface IRatingUser {
    userId: number | string;
    rank: number;
    oldRating: number;
}
export interface IRatingUserCal {
    userId: number | string;
    rank: number;
    _rank: number;
    oldRating: number;
    newRating: number;
    seed: number;
    delta: number;
    officialNewRating?: number;
}
export declare type RatingCalProgressCallback = (progress: number) => void | Promise<void>;
export interface ICalculateRatingOptions {
    users: IRatingUser[];
    onProgress: RatingCalProgressCallback;
}
declare function calculateRating(opt: ICalculateRatingOptions): Promise<IRatingUserCal[]>;
export default calculateRating;
