export const HOME_BANNER_DETAIL_ROUTE = '/home/banner/$bannerId';

export const getHomeBannerDetailPath = (bannerId: number) => `/home/banner/${bannerId}`;

export const parseHomeBannerId = (bannerId?: string) => {
  const parsedBannerId = Number(bannerId);
  return Number.isInteger(parsedBannerId) && parsedBannerId > 0 ? parsedBannerId : null;
};
