# 电脑锁屏应用

当前为**测试**使用仅供娱乐！！！

一个功能完整的电脑锁屏应用，支持壁纸更换、密码解锁、远程解锁申请等功能。

## 功能特性

- <span data-name="lock" data-type="emoji">🔒</span> 锁屏功能

- <span data-name="frame_with_picture" data-type="emoji">🖼</span> 壁纸更换

- <span data-name="closed_lock_with_key" data-type="emoji">🔐</span> 密码解锁

- <span data-name="warning" data-type="emoji">⚠</span> 输错密码提示

- <span data-name="android" data-type="emoji">📱</span> 远程解锁申请

- <span data-name="globe_with_meridians" data-type="emoji">🌐</span> 配套管理网站

## 安装运行

1.首先fork我的项目到你的仓库

![SnowShot2026-07-0722-40-12.png](https://tc.chouye.qzz.io/api/cfile/AgACAgUAAyEGAATUZiJwAAM3ak3dR8Vfmb7-7MtfWN6FU4ehhh4AAroOaxssInFW6mCbgWLuXpEBAAMCAAN3AAM8BA)2.登录cloud flare创建应用程序

![SnowShot2026-07-0722-44-11.png](https://tc.chouye.qzz.io/api/cfile/AgACAgUAAyEGAATUZiJwAAM1ak3dQ_Q88HuoyiKJkxP4BAZOMGYAArcOaxssInFW86SBKTY2rHYBAAMCAAN3AAM8BA)3.连接GitHub

![SnowShot2026-07-0722-44-24.png](https://tc.chouye.qzz.io/api/cfile/AgACAgUAAyEGAATUZiJwAAM0ak3dPrCoZvAHhllU9QdZnYUF1A8AArYOaxssInFWKmhmuAEhPuwBAAMCAAN3AAM8BA)4.克隆对应的仓库

![SnowShot2026-07-0812-21-32.png](https://tc.chouye.qzz.io/api/cfile/AgACAgUAAyEGAATUZiJwAAMzak3dMRm7_Jbzbhp8vX6M0mHLtscAArUOaxssInFW6P3FWz1zIPQBAAMCAAN3AAM8BA)5.进行构建全部默认即可

6.创建kv空间LOCKSCREEN_KV

7.为构建好的worker绑定创建的kv

变量名称都填LOCKSCREEN_KV

![SnowShot_2026-07-08_12-33-25.png](https://tc.chouye.qzz.io/api/cfile/AgACAgUAAyEGAATUZiJwAAMxak3YHHLdC0pruj-XJjW-4MUgdKQAAqoOaxssInFWW8puqGpFeMkBAAMCAAN3AAM8BA)绑定完成后为后端**绑定自己的域名**即可访问

管理员账号密码

<table style="width: 200px">
<colgroup><col style="100px"><col style="100px"></colgroup><tbody><tr><td colspan="1" rowspan="1" colwidth="100"><p>账号</p></td><td colspan="1" rowspan="1" colwidth="100"><p>admin</p></td></tr><tr><td colspan="1" rowspan="1" colwidth="100"><p>密码</p></td><td colspan="1" rowspan="1" colwidth="100"><p>admin123</p></td></tr></tbody>
</table>

登录后**记得改密码**

在应用程序内**填写你的域名**即可**使用**
